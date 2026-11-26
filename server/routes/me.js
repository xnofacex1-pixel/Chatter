import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { db, nowIso, uploadsPath } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { passwordProblem, verifyPassword } from '../lib/passwords.js';
import { publicUser, settingsFor, STATUSES, touchPresence } from '../lib/presenters.js';
import { rateLimit } from '../lib/rate-limit.js';
import { audit, revokeAllSessions } from '../lib/sessions.js';
import { currentSessionUser } from './auth.js';
import { hashPassword } from '../lib/passwords.js';

export const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

export function requireUser(req, _res, next) {
  const found = currentSessionUser(req);
  if (!found) return next(Object.assign(new Error('Sign in to continue.'), { status: 401, code: 'not_authenticated' }));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(found.session.user_id);
  if (!user) return next(Object.assign(new Error('Sign in to continue.'), { status: 401, code: 'not_authenticated' }));
  if (user.is_banned) return next(Object.assign(new Error('This account is suspended.'), { status: 403, code: 'account_banned' }));
  if (user.suspended_until && user.suspended_until > nowIso()) {
    return next(
      Object.assign(new Error('This account is temporarily suspended.'), {
        status: 403,
        code: 'account_suspended',
      }),
    );
  }
  req.user = user;
  req.sessionId = found.session.session_id;
  next();
}

router.use(requireUser);

router.get(
  '/',
  route(async (req, res) => {
    res.json({ user: publicUser(req.user, { includeEmail: true }), settings: settingsFor(req.user.id) });
  }),
);

router.post(
  '/heartbeat',
  rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'heartbeat' }),
  route(async (req, res) => {
    touchPresence(req.user.id);
    res.json({ ok: true, serverTime: nowIso() });
  }),
);

const accountSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(USERNAME_RE, 'Use 3-24 letters, numbers, dots, dashes or underscores.').optional(),
  displayName: z.string().trim().min(1).max(32).optional(),
  email: z.string().trim().min(5).max(254).regex(EMAIL_RE, 'Enter a valid email address.').optional(),
});

router.patch(
  '/account',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: 'account-update' }),
  route(async (req, res) => {
    const parsed = accountSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Check the highlighted fields.');

    const updates = [];
    const values = [];
    const emailChanged = parsed.data.email && parsed.data.email.toLowerCase() !== req.user.email;

    if (parsed.data.username && parsed.data.username.toLowerCase() !== req.user.username_lower) {
      const lower = parsed.data.username.toLowerCase();
      if (db.prepare('SELECT 1 FROM users WHERE username_lower = ? AND id <> ?').get(lower, req.user.id)) {
        return fail(409, 'username_taken', 'That username is already taken.', {
          fields: [{ field: 'username', message: 'That username is already taken.' }],
        });
      }
      updates.push('username = ?', 'username_lower = ?');
      values.push(parsed.data.username, lower);
    }
    if (parsed.data.displayName && parsed.data.displayName !== req.user.display_name) {
      updates.push('display_name = ?');
      values.push(parsed.data.displayName);
    }
    if (emailChanged) {
      const lower = parsed.data.email.toLowerCase();
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(lower, req.user.id)) {
        return fail(409, 'email_taken', 'An account with that email already exists.', {
          fields: [{ field: 'email', message: 'An account with that email already exists.' }],
        });
      }
      updates.push('email = ?', 'email_verified_at = NULL');
      values.push(lower);
    }

    if (updates.length === 0) {
      return res.json({ user: publicUser(req.user, { includeEmail: true }), settings: settingsFor(req.user.id) });
    }

    updates.push('updated_at = ?');
    values.push(nowIso(), req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    audit(req.user.id, 'user.account_updated', {
      targetType: 'user',
      targetId: req.user.id,
      metadata: { emailChanged: Boolean(emailChanged) },
      ip: clientIp(req),
    });

    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(fresh, { includeEmail: true }), settings: settingsFor(fresh.id) });
  }),
);

const profileSchema = z.object({
  customStatus: z.string().trim().max(80).nullable().optional(),
  aboutMe: z.string().trim().max(600).nullable().optional(),
  pronouns: z.string().trim().max(40).nullable().optional(),
  accentColor: z.string().trim().regex(HEX_COLOR_RE, 'Choose a valid hex colour.').optional(),
  bannerColor: z.string().trim().regex(HEX_COLOR_RE, 'Choose a valid hex colour.').optional(),
});

router.patch(
  '/profile',
  route(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Check the highlighted fields.');
    const fields = [];
    const values = [];
    const map = {
      customStatus: 'custom_status',
      aboutMe: 'about_me',
      pronouns: 'pronouns',
      accentColor: 'accent_color',
      bannerColor: 'banner_color',
    };
    for (const [key, column] of Object.entries(map)) {
      if (parsed.data[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(parsed.data[key] === '' ? null : parsed.data[key]);
      }
    }
    if (fields.length === 0) return res.json({ user: publicUser(req.user, { includeEmail: true }) });
    values.push(req.user.id);
    db.prepare(`UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(nowIso(), req.user.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(fresh, { includeEmail: true }) });
  }),
);

const presenceSchema = z.object({ status: z.enum(STATUSES) });

router.patch(
  '/presence',
  route(async (req, res) => {
    const parsed = presenceSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Choose a valid status.');
    touchPresence(req.user.id, parsed.data.status);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(fresh, { includeEmail: true }) });
  }),
);

const settingsSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  accent: z.enum(['cyan', 'blue', 'violet', 'emerald', 'rose', 'amber']).optional(),
  reducedMotion: z.boolean().optional(),
  compactMode: z.boolean().optional(),
  textScale: z.number().min(0.85).max(1.3).optional(),
  messageDisplay: z.enum(['cozy', 'compact']).optional(),
  dmPrivacy: z.enum(['everyone', 'friends', 'none']).optional(),
  friendRequestPrivacy: z.enum(['everyone', 'friends', 'none']).optional(),
  presenceVisibility: z.enum(['everyone', 'friends', 'nobody']).optional(),
  readReceipts: z.boolean().optional(),
  notifications: z
    .object({
      desktop: z.boolean().optional(),
      sounds: z.boolean().optional(),
      mentions: z.boolean().optional(),
      messages: z.boolean().optional(),
      calls: z.boolean().optional(),
    })
    .optional(),
});

router.patch(
  '/settings',
  route(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Check the highlighted settings.');
    const data = parsed.data;
    const fields = [];
    const values = [];
    const push = (column, value) => {
      if (value !== undefined) {
        fields.push(`${column} = ?`);
        values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      }
    };
    push('theme', data.theme);
    push('accent', data.accent);
    push('reduced_motion', data.reducedMotion);
    push('compact_mode', data.compactMode);
    push('text_scale', data.textScale);
    push('message_display', data.messageDisplay);
    push('dm_privacy', data.dmPrivacy);
    push('friend_request_privacy', data.friendRequestPrivacy);
    push('presence_visibility', data.presenceVisibility);
    push('read_receipts', data.readReceipts);
    if (data.notifications) {
      push('notif_desktop', data.notifications.desktop);
      push('notif_sounds', data.notifications.sounds);
      push('notif_mentions', data.notifications.mentions);
      push('notif_messages', data.notifications.messages);
      push('notif_calls', data.notifications.calls);
    }
    if (fields.length === 0) return res.json({ settings: settingsFor(req.user.id) });
    fields.push('updated_at = ?');
    values.push(nowIso(), req.user.id);
    db.prepare(`UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    res.json({ settings: settingsFor(req.user.id) });
  }),
);

function storeImage(req, kind) {
  if (!req.file) return fail(400, 'no_file', 'Choose an image to upload.');
  const extension = IMAGE_TYPES[req.file.mimetype];
  if (!extension) return fail(415, 'unsupported_type', 'Upload a PNG, JPEG, WebP or GIF image.');
  if (req.file.size > 5 * 1024 * 1024) return fail(413, 'file_too_large', 'Images must be 5 MB or smaller.');
  if (req.file.size === 0) return fail(400, 'empty_file', 'That file is empty.');

  const id = randomUUID();
  const filename = `${id}.${extension}`;
  const target = path.join(uploadsPath, filename);
  fs.writeFileSync(target, req.file.buffer, { mode: 0o600 });
  db.prepare(
    `INSERT INTO media (id, owner_id, kind, mime, byte_size, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.user.id, kind, req.file.mimetype, req.file.size, filename, nowIso());
  return id;
}

function uploadHandler(kind, column) {
  return [
    upload.single('file'),
    route(async (req, res) => {
      const mediaId = storeImage(req, kind);
      const previous = db.prepare(`SELECT ${column} AS id FROM user_profiles WHERE user_id = ?`).get(req.user.id)?.id;
      db.prepare(`UPDATE user_profiles SET ${column} = ? WHERE user_id = ?`).run(mediaId, req.user.id);
      if (previous) removeMedia(req.user.id, previous);
      audit(req.user.id, `user.${kind}_uploaded`, { targetType: 'media', targetId: mediaId, ip: clientIp(req) });
      const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      res.json({ user: publicUser(fresh, { includeEmail: true }) });
    }),
  ];
}

function removeMedia(ownerId, mediaId) {
  const row = db.prepare('SELECT * FROM media WHERE id = ? AND owner_id = ?').get(mediaId, ownerId);
  if (!row) return false;
  db.prepare('UPDATE user_profiles SET avatar_media_id = NULL WHERE avatar_media_id = ?').run(mediaId);
  db.prepare('UPDATE user_profiles SET banner_media_id = NULL WHERE banner_media_id = ?').run(mediaId);
  db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);
  try {
    fs.unlinkSync(path.join(uploadsPath, row.storage_path));
  } catch {
    /* file already gone */
  }
  return true;
}

router.post('/avatar', ...uploadHandler('avatar', 'avatar_media_id'));
router.post('/banner', ...uploadHandler('banner', 'banner_media_id'));

router.delete(
  '/avatar',
  route(async (req, res) => {
    const row = db.prepare('SELECT avatar_media_id AS id FROM user_profiles WHERE user_id = ?').get(req.user.id);
    if (row?.id) removeMedia(req.user.id, row.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(fresh, { includeEmail: true }) });
  }),
);

router.delete(
  '/banner',
  route(async (req, res) => {
    const row = db.prepare('SELECT banner_media_id AS id FROM user_profiles WHERE user_id = ?').get(req.user.id);
    if (row?.id) removeMedia(req.user.id, row.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(fresh, { includeEmail: true }) });
  }),
);

const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

router.post(
  '/password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'password' }),
  route(async (req, res) => {
    const parsed = passwordChangeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Enter your current and new password.');
    const ok = await verifyPassword(parsed.data.currentPassword, req.user.password_hash);
    if (!ok) return fail(403, 'invalid_credentials', 'Your current password is incorrect.');
    const problem = passwordProblem(parsed.data.newPassword);
    if (problem) return fail(400, 'weak_password', problem);
    const hash = await hashPassword(parsed.data.newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), req.user.id);
    revokeAllSessions(req.user.id, req.sessionId);
    audit(req.user.id, 'user.password_changed', { ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

const deleteAccountSchema = z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE') });

router.delete(
  '/',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'delete-account' }),
  route(async (req, res) => {
    const parsed = deleteAccountSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Type DELETE and confirm your password to remove your account.');
    if (req.user.is_owner) return fail(403, 'owner_protected', 'The owner account cannot be deleted from the app.');
    const ok = await verifyPassword(parsed.data.password, req.user.password_hash);
    if (!ok) return fail(403, 'invalid_credentials', 'Your password is incorrect.');
    audit(req.user.id, 'user.account_deleted', { targetType: 'user', targetId: req.user.id, ip: clientIp(req) });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    res.json({ ok: true });
  }),
);
