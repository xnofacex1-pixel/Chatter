import { Router } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { addDays, addMinutes, db, nowIso, transaction } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { fakeVerify, hashPassword, passwordProblem, verifyPassword } from '../lib/passwords.js';
import { mailConfigured, sendPasswordResetEmail } from '../lib/mailer.js';
import { publicUser, settingsFor, touchPresence } from '../lib/presenters.js';
import { rateLimit } from '../lib/rate-limit.js';
import {
  audit,
  clearSessionCookie,
  consumeAuthToken,
  createAuthToken,
  createSession,
  findSession,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
  setSessionCookie,
} from '../lib/sessions.js';
import { parseCookies } from '../lib/http.js';

export const router = Router();

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'masongiacoppo@outlook.com').trim().toLowerCase();
const OWNER_DISPLAY_NAME = process.env.OWNER_DISPLAY_NAME || 'Mason';
const OWNER_TITLE = 'Founder & Owner';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,24}$/;
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'owner', 'chatter', 'support', 'staff', 'moderator', 'mod',
  'system', 'root', 'help', 'official', 'security', 'everyone', 'here', 'null', 'undefined',
]);

const registerSchema = z.object({
  email: z.string().trim().min(5).max(254).regex(EMAIL_RE, 'Enter a valid email address.'),
  username: z.string().trim().min(3).max(24).regex(USERNAME_RE, 'Use 3-24 letters, numbers, dots, dashes or underscores.'),
  displayName: z.string().trim().min(1).max(32).optional(),
  password: z.string().min(1).max(200),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
});

const emailSchema = z.object({ email: z.string().trim().min(5).max(254).regex(EMAIL_RE, 'Enter a valid email address.') });
const resetSchema = z.object({ token: z.string().trim().min(10).max(200), password: z.string().min(1).max(200) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

function normaliseUsername(value) {
  return value.toLowerCase();
}

function currentSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  const session = findSession(token);
  return session ? { session, token } : null;
}

function respondWithSession(res, user, extra = {}) {
  return res.json({
    user: publicUser(user, { includeEmail: true }),
    settings: settingsFor(user.id),
    ...extra,
  });
}

router.post(
  '/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 12, keyPrefix: 'register', message: 'Too many accounts created from this network. Try again later.' }),
  route(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Check the highlighted fields.', {
        fields: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
      });
    }
    const { email, username, password } = parsed.data;
    const displayName = (parsed.data.displayName || username).trim();

    const problem = passwordProblem(password);
    if (problem) return fail(400, 'weak_password', problem, { fields: [{ field: 'password', message: problem }] });

    const lowerEmail = email.toLowerCase();
    const lowerUsername = normaliseUsername(username);
    if (RESERVED_USERNAMES.has(lowerUsername)) {
      return fail(400, 'username_reserved', 'That username is reserved. Please choose another.', {
        fields: [{ field: 'username', message: 'That username is reserved.' }],
      });
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(lowerEmail)) {
      return fail(409, 'email_taken', 'An account with that email already exists.', {
        fields: [{ field: 'email', message: 'An account with that email already exists.' }],
      });
    }
    if (db.prepare('SELECT 1 FROM users WHERE username_lower = ?').get(lowerUsername)) {
      return fail(409, 'username_taken', 'That username is already taken.', {
        fields: [{ field: 'username', message: 'That username is already taken.' }],
      });
    }

    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const createdAt = nowIso();

    transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, username, username_lower, display_name, password_hash, status, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)`,
      ).run(userId, lowerEmail, username, lowerUsername, displayName, passwordHash, createdAt, createdAt, createdAt);
      db.prepare('INSERT INTO user_profiles (user_id) VALUES (?)').run(userId);
      db.prepare('INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)').run(userId, createdAt);
    });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    const session = createSession(userId, req);
    setSessionCookie(res, session.token, session.expiresAt);
    audit(userId, 'user.register', { targetType: 'user', targetId: userId, ip: clientIp(req) });

    res.status(201).json({
      user: publicUser(user, { includeEmail: true }),
      settings: settingsFor(userId),
    });
  }),
);

router.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'login', message: 'Too many login attempts. Please wait 15 minutes.' }),
  route(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Enter your email or username and password.');
    const identifier = parsed.data.identifier.toLowerCase();
    const user = identifier.includes('@')
      ? db.prepare('SELECT * FROM users WHERE email = ?').get(identifier)
      : db.prepare('SELECT * FROM users WHERE username_lower = ?').get(identifier);

    if (!user) {
      await fakeVerify(parsed.data.password);
      return fail(401, 'invalid_credentials', 'Email, username or password is incorrect.');
    }
    const ok = await verifyPassword(parsed.data.password, user.password_hash);
    if (!ok) {
      audit(user.id, 'user.login_failed', { ip: clientIp(req) });
      return fail(401, 'invalid_credentials', 'Email, username or password is incorrect.');
    }
    if (user.is_banned) return fail(403, 'account_banned', 'This account has been suspended. Contact support if you believe this is a mistake.');
    if (user.suspended_until && new Date(user.suspended_until).getTime() > Date.now()) {
      return fail(403, 'account_suspended', 'This account is temporarily suspended.');
    }

    const status = user.status === 'offline' || user.status === 'invisible' ? 'online' : user.status;
    touchPresence(user.id, status);
    const session = createSession(user.id, req);
    setSessionCookie(res, session.token, session.expiresAt);
    audit(user.id, 'user.login', { ip: clientIp(req) });

    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    respondWithSession(res, fresh);
  }),
);

router.get(
  '/session',
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (!found) return res.json({ user: null, settings: null });
    touchPresence(found.session.user_id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(found.session.user_id);
    if (!user || user.is_banned) {
      clearSessionCookie(res);
      return res.json({ user: null, settings: null });
    }
    res.json({ user: publicUser(user, { includeEmail: true }), settings: settingsFor(user.id) });
  }),
);

router.post(
  '/logout',
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (found) {
      revokeSession(found.session.session_id);
      audit(found.session.user_id, 'user.logout', { ip: clientIp(req) });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

/**
 * Owner access is granted server-side only, never from a browser-supplied role.
 * The account must match the configured OWNER_EMAIL and present the deployment's
 * OWNER_SETUP_CODE, compared in constant time. Existing owner rows are preserved.
 */
const OWNER_SETUP_CODE = (process.env.OWNER_SETUP_CODE || '').trim();

router.get(
  '/owner-claim',
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (!found) return res.json({ eligible: false, configured: Boolean(OWNER_SETUP_CODE) });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(found.session.user_id);
    res.json({
      eligible: Boolean(user && user.email === OWNER_EMAIL && !user.is_owner),
      configured: Boolean(OWNER_SETUP_CODE),
      isOwner: Boolean(user?.is_owner),
    });
  }),
);

router.post(
  '/owner-claim',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 8, keyPrefix: 'owner-claim', message: 'Too many attempts. Try again in 15 minutes.' }),
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (!found) return fail(401, 'not_authenticated', 'Sign in to claim owner access.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(found.session.user_id);
    if (!user) return fail(401, 'not_authenticated', 'Sign in to claim owner access.');
    if (user.email !== OWNER_EMAIL) {
      return fail(403, 'not_owner_account', 'This account is not the configured owner account.');
    }
    if (!OWNER_SETUP_CODE) {
      return fail(
        503,
        'owner_claim_disabled',
        'Owner claiming is not enabled on this deployment. Add OWNER_SETUP_CODE to the server environment first.',
      );
    }
    const parsed = z.object({ code: z.string().trim().min(4).max(200) }).safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Enter the owner setup code.');

    const supplied = Buffer.from(parsed.data.code);
    const expected = Buffer.from(OWNER_SETUP_CODE);
    const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
    if (!matches) {
      audit(user.id, 'owner.claim_failed', { ip: clientIp(req) });
      return fail(403, 'invalid_code', 'That owner setup code is incorrect.');
    }

    const now = nowIso();
    db.prepare(
      `UPDATE users
          SET is_owner = 1,
              title = COALESCE(NULLIF(title, ''), ?),
              display_name = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(OWNER_TITLE, OWNER_DISPLAY_NAME, now, user.id);
    audit(user.id, 'owner.granted', {
      targetType: 'user',
      targetId: user.id,
      metadata: { method: 'owner_setup_code' },
      ip: clientIp(req),
    });

    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({ ok: true, user: publicUser(fresh, { includeEmail: true }), settings: settingsFor(fresh.id) });
  }),
);

router.post(
  '/forgot-password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 6, keyPrefix: 'forgot' }),
  route(async (req, res) => {
    const parsed = emailSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Enter the email address for your account.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(parsed.data.email.toLowerCase());
    // Always the same response so the endpoint cannot be used to discover accounts.
    const base = { ok: true, emailConfigured: mailConfigured() };
    if (!user) return res.json({ ...base, emailSent: false });
    const token = createAuthToken(user.id, 'reset', 60);
    const mail = await sendPasswordResetEmail(user, token);
    audit(user.id, 'user.password_reset_requested', { ip: clientIp(req) });
    const expose = process.env.NODE_ENV !== 'production' && !mail.delivered;
    res.json({ ...base, emailSent: mail.delivered, ...(expose ? { resetUrl: mail.url } : {}) });
  }),
);

router.post(
  '/reset-password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'reset' }),
  route(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'This reset link is incomplete.');
    const problem = passwordProblem(parsed.data.password);
    if (problem) return fail(400, 'weak_password', problem);
    const record = consumeAuthToken(parsed.data.token, 'reset');
    if (!record) return fail(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');

    const hash = await hashPassword(parsed.data.password);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), record.user_id);
    revokeAllSessions(record.user_id);
    clearSessionCookie(res);
    audit(record.user_id, 'user.password_reset', { ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

router.post(
  '/change-password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'change-password' }),
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (!found) return fail(401, 'not_authenticated', 'Sign in again to change your password.');
    const parsed = changePasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Enter your current and new password.');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(found.session.user_id);
    if (!user) return fail(401, 'not_authenticated', 'Sign in again to change your password.');
    const ok = await verifyPassword(parsed.data.currentPassword, user.password_hash);
    if (!ok) return fail(403, 'invalid_credentials', 'Your current password is incorrect.');
    const problem = passwordProblem(parsed.data.newPassword);
    if (problem) return fail(400, 'weak_password', problem);

    const hash = await hashPassword(parsed.data.newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), user.id);
    revokeAllSessions(user.id, found.session.session_id);
    audit(user.id, 'user.password_changed', { ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

router.get(
  '/sessions',
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (!found) return fail(401, 'not_authenticated', 'Sign in to manage your sessions.');
    const rows = db
      .prepare(
        `SELECT id, user_agent, ip, created_at, last_used_at, expires_at
           FROM sessions
          WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY last_used_at DESC`,
      )
      .all(found.session.user_id, nowIso());
    res.json({
      sessions: rows.map((row) => ({
        id: row.id,
        device: row.user_agent,
        ip: row.ip,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        current: row.id === found.session.session_id,
      })),
    });
  }),
);

router.delete(
  '/sessions/:id',
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (!found) return fail(401, 'not_authenticated', 'Sign in to manage your sessions.');
    const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, found.session.user_id);
    if (!row) return fail(404, 'not_found', 'That session no longer exists.');
    revokeSession(row.id);
    audit(found.session.user_id, 'user.session_revoked', { targetType: 'session', targetId: row.id, ip: clientIp(req) });
    if (row.id === found.session.session_id) clearSessionCookie(res);
    res.json({ ok: true, signedOut: row.id === found.session.session_id });
  }),
);

router.post(
  '/sessions/revoke-others',
  route(async (req, res) => {
    const found = currentSessionUser(req);
    if (!found) return fail(401, 'not_authenticated', 'Sign in to manage your sessions.');
    revokeAllSessions(found.session.user_id, found.session.session_id);
    audit(found.session.user_id, 'user.sessions_revoked_all', { ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

export { currentSessionUser };
