import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, nowIso } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { publicUser } from '../lib/presenters.js';
import { rateLimit } from '../lib/rate-limit.js';
import { audit } from '../lib/sessions.js';
import { requireUser } from './me.js';
import {
  STAFF_PERMISSIONS,
  STAFF_ROLES,
  appSettings,
  count,
  requireOwner,
  requirePermission,
  saveAppSettings,
  staffPermissions,
} from '../lib/admin.js';

export const router = Router();
router.use(requireUser);

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

const idParam = (req) => {
  const id = String(req.params.id ?? '').trim();
  if (!id) fail(400, 'invalid_id', 'A target id is required.');
  return id;
};

const userRow = (id) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) fail(404, 'user_not_found', 'That account no longer exists.');
  return row;
};

const serverRow = (id) => {
  const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!row) fail(404, 'server_not_found', 'That community no longer exists.');
  return row;
};

const moderationHistory = (userId) =>
  db
    .prepare(
      `SELECT m.*, a.display_name AS actor_name
         FROM platform_moderation m
         LEFT JOIN users a ON a.id = m.actor_id
        WHERE m.target_user_id = ?
        ORDER BY m.created_at DESC
        LIMIT 40`,
    )
    .all(userId);

/* ------------------------------------------------------------------ access */

/** Lets the client decide which console tabs to render. */
router.get(
  '/access',
  route(async (req, res) => {
    res.json({
      owner: Boolean(req.user.is_owner),
      permissions: staffPermissions(req.user.id),
      roles: STAFF_ROLES,
      available: STAFF_PERMISSIONS,
    });
  }),
);

/* ---------------------------------------------------------------- overview */

router.get(
  '/overview',
  rateLimit({ windowMs: 60 * 1000, max: 120, keyPrefix: 'admin-overview' }),
  route(async (req, res) => {
    requireOwner(req);
    const cutoff = isoAgo(ONLINE_WINDOW_MS);
    const weekAgo = isoAgo(7 * 24 * 60 * 60 * 1000);

    const stats = {
      totalUsers: count('SELECT COUNT(*) AS count FROM users'),
      onlineUsers: count(
        "SELECT COUNT(*) AS count FROM users WHERE status IN ('online','idle','dnd') AND last_seen_at >= ?",
        cutoff,
      ),
      offlineUsers: count('SELECT COUNT(*) AS count FROM users WHERE last_seen_at IS NULL OR last_seen_at < ?', cutoff),
      totalServers: count('SELECT COUNT(*) AS count FROM servers'),
      suspendedServers: count('SELECT COUNT(*) AS count FROM servers WHERE is_suspended = 1'),
      totalChannels: count('SELECT COUNT(*) AS count FROM server_channels'),
      totalMessages: count('SELECT COUNT(*) AS count FROM messages'),
      activeCalls: count("SELECT COUNT(*) AS count FROM calls WHERE status IN ('ringing','active')"),
      newRegistrations: count('SELECT COUNT(*) AS count FROM users WHERE created_at >= ?', weekAgo),
      bannedUsers: count('SELECT COUNT(*) AS count FROM users WHERE is_banned = 1'),
      suspendedUsers: count('SELECT COUNT(*) AS count FROM users WHERE suspended_until IS NOT NULL AND suspended_until > ?', nowIso()),
      openReports: count("SELECT COUNT(*) AS count FROM reports WHERE status = 'open'"),
      staffCount: count('SELECT COUNT(DISTINCT user_id) AS count FROM staff_assignments WHERE revoked_at IS NULL'),
    };

    const recentActivity = db
      .prepare(
        `SELECT l.id, l.action, l.target_type, l.target_id, l.created_at, u.display_name AS actor_name, u.username AS actor_username
           FROM audit_logs l
           LEFT JOIN users u ON u.id = l.actor_id
          ORDER BY l.created_at DESC
          LIMIT 14`,
      )
      .all();

    const recentUsers = db
      .prepare(
        `SELECT id, username, display_name, created_at, email_verified_at
           FROM users ORDER BY created_at DESC LIMIT 6`,
      )
      .all();

    res.json({
      stats,
      recentActivity,
      recentUsers,
      health: {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        node: process.version,
        database: 'connected',
        checkedAt: nowIso(),
      },
      settings: appSettings(),
    });
  }),
);

/* ------------------------------------------------------------------- users */

router.get(
  '/users',
  route(async (req, res) => {
    requirePermission(req, 'moderate.users');
    const query = String(req.query.query ?? '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const like = `%${query.toLowerCase()}%`;
    const where = query
      ? 'WHERE lower(u.username) LIKE ? OR lower(u.display_name) LIKE ? OR lower(u.email) LIKE ?'
      : '';
    const params = query ? [like, like, like] : [];

    const rows = db
      .prepare(
        `SELECT u.*,
                (SELECT COUNT(*) FROM server_members m WHERE m.user_id = u.id) AS server_count,
                (SELECT COUNT(*) FROM messages msg WHERE msg.author_id = u.id) AS message_count,
                (SELECT COUNT(*) FROM reports r WHERE r.reported_user_id = u.id AND r.status = 'open') AS open_reports
           FROM users u
           ${where}
          ORDER BY u.is_owner DESC, u.created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    const total = count(
      `SELECT COUNT(*) AS count FROM users u ${where}`,
      ...params,
    );

    res.json({
      total,
      users: rows.map((row) => ({
        ...publicUser(row, { includeEmail: true }),
        serverCount: row.server_count,
        messageCount: row.message_count,
        openReports: row.open_reports,
        isBanned: Boolean(row.is_banned),
        bannedReason: row.banned_reason ?? null,
        suspendedUntil: row.suspended_until ?? null,
        suspendedReason: row.suspended_reason ?? null,
      })),
    });
  }),
);

router.get(
  '/users/:id',
  route(async (req, res) => {
    requirePermission(req, 'moderate.users');
    const row = userRow(idParam(req));
    const servers = db
      .prepare(
        `SELECT s.id, s.name, s.is_suspended, m.role
           FROM server_members m JOIN servers s ON s.id = m.server_id
          WHERE m.user_id = ? ORDER BY s.name COLLATE NOCASE ASC LIMIT 40`,
      )
      .all(row.id);
    const reports = db
      .prepare(
        `SELECT id, reason, details, status, created_at
           FROM reports WHERE reported_user_id = ? ORDER BY created_at DESC LIMIT 25`,
      )
      .all(row.id);

    res.json({
      user: publicUser(row, { includeEmail: true }),
      servers,
      reports,
      moderation: moderationHistory(row.id),
      counts: {
        messages: count('SELECT COUNT(*) AS count FROM messages WHERE author_id = ?', row.id),
        friends: count(
          'SELECT COUNT(*) AS count FROM friendships WHERE user_id = ?',
          row.id,
        ),
      },
    });
  }),
);

const moderationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  hours: z.number().min(1).max(24 * 90).optional(),
});

function guardOwnerTarget(target, action) {
  if (target.is_owner) {
    fail(403, 'owner_protected', `The owner account cannot be ${action}.`);
  }
}

router.post(
  '/users/:id/suspend',
  route(async (req, res) => {
    requirePermission(req, 'moderate.users');
    const target = userRow(idParam(req));
    guardOwnerTarget(target, 'suspended');
    const parsed = moderationSchema.safeParse(req.body ?? {});
    if (!parsed.success) fail(400, 'invalid_input', 'Provide a valid suspension length and reason.');
    const hours = parsed.data.hours ?? 24;
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const reason = parsed.data.reason ?? 'Community guidelines violation';

    db.prepare(
      'UPDATE users SET suspended_until = ?, suspended_reason = ?, suspended_by = ?, updated_at = ? WHERE id = ?',
    ).run(until, reason, req.user.id, nowIso(), target.id);
    db.prepare(
      'INSERT INTO platform_moderation (id, actor_id, target_user_id, action, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), req.user.id, target.id, 'suspend', reason, until, nowIso());
    audit(req.user.id, 'admin.user_suspended', {
      targetType: 'user',
      targetId: target.id,
      metadata: { hours, reason },
      ip: clientIp(req),
    });
    res.json({ ok: true, suspendedUntil: until });
  }),
);

router.post(
  '/users/:id/unsuspend',
  route(async (req, res) => {
    requirePermission(req, 'moderate.users');
    const target = userRow(idParam(req));
    db.prepare(
      'UPDATE users SET suspended_until = NULL, suspended_reason = NULL, suspended_by = NULL, updated_at = ? WHERE id = ?',
    ).run(nowIso(), target.id);
    db.prepare(
      'INSERT INTO platform_moderation (id, actor_id, target_user_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), req.user.id, target.id, 'unsuspend', req.body?.reason ?? null, nowIso());
    audit(req.user.id, 'admin.user_unsuspended', { targetType: 'user', targetId: target.id, ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

router.post(
  '/users/:id/ban',
  route(async (req, res) => {
    requirePermission(req, 'moderate.users');
    const target = userRow(idParam(req));
    guardOwnerTarget(target, 'banned');
    const reason = String(req.body?.reason ?? '').trim() || 'Community guidelines violation';
    db.prepare('UPDATE users SET is_banned = 1, banned_reason = ?, updated_at = ? WHERE id = ?').run(
      reason,
      nowIso(),
      target.id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    db.prepare(
      'INSERT INTO platform_moderation (id, actor_id, target_user_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), req.user.id, target.id, 'ban', reason, nowIso());
    audit(req.user.id, 'admin.user_banned', {
      targetType: 'user',
      targetId: target.id,
      metadata: { reason },
      ip: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/users/:id/unban',
  route(async (req, res) => {
    requirePermission(req, 'moderate.users');
    const target = userRow(idParam(req));
    db.prepare('UPDATE users SET is_banned = 0, banned_reason = NULL, updated_at = ? WHERE id = ?').run(
      nowIso(),
      target.id,
    );
    db.prepare(
      'INSERT INTO platform_moderation (id, actor_id, target_user_id, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), req.user.id, target.id, 'unban', req.body?.reason ?? null, nowIso());
    audit(req.user.id, 'admin.user_unbanned', { targetType: 'user', targetId: target.id, ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

router.delete(
  '/users/:id',
  route(async (req, res) => {
    requireOwner(req);
    const target = userRow(idParam(req));
    guardOwnerTarget(target, 'deleted');
    if (String(req.body?.confirm ?? '') !== target.username) {
      fail(400, 'confirmation_required', 'Type the exact username to confirm deletion.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    audit(req.user.id, 'admin.user_deleted', {
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username },
      ip: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

/* ----------------------------------------------------------------- servers */

router.get(
  '/servers',
  route(async (req, res) => {
    requirePermission(req, 'manage.servers');
    const query = String(req.query.query ?? '').trim();
    const like = `%${query.toLowerCase()}%`;
    const where = query ? 'WHERE lower(s.name) LIKE ?' : '';
    const params = query ? [like] : [];
    const rows = db
      .prepare(
        `SELECT s.id, s.name, s.description, s.is_public, s.is_suspended, s.created_at, s.owner_id,
                u.display_name AS owner_name, u.username AS owner_username,
                (SELECT COUNT(*) FROM server_members m WHERE m.server_id = s.id) AS member_count,
                (SELECT COUNT(*) FROM server_channels c WHERE c.server_id = s.id) AS channel_count
           FROM servers s LEFT JOIN users u ON u.id = s.owner_id
           ${where}
          ORDER BY s.created_at DESC LIMIT 100`,
      )
      .all(...params);
    res.json({ total: rows.length, servers: rows });
  }),
);

router.post(
  '/servers/:id/suspend',
  route(async (req, res) => {
    requirePermission(req, 'manage.servers');
    const server = serverRow(idParam(req));
    const reason = String(req.body?.reason ?? '').trim() || 'Pending platform review';
    db.prepare('UPDATE servers SET is_suspended = 1 WHERE id = ?').run(server.id);
    audit(req.user.id, 'admin.server_suspended', {
      targetType: 'server',
      targetId: server.id,
      metadata: { reason },
      ip: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/servers/:id/unsuspend',
  route(async (req, res) => {
    requirePermission(req, 'manage.servers');
    const server = serverRow(idParam(req));
    db.prepare('UPDATE servers SET is_suspended = 0 WHERE id = ?').run(server.id);
    audit(req.user.id, 'admin.server_unsuspended', { targetType: 'server', targetId: server.id, ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

router.delete(
  '/servers/:id',
  route(async (req, res) => {
    requirePermission(req, 'manage.servers');
    const server = serverRow(idParam(req));
    if (String(req.body?.confirm ?? '') !== server.name) {
      fail(400, 'confirmation_required', 'Type the exact community name to confirm removal.');
    }
    db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);
    audit(req.user.id, 'admin.server_removed', {
      targetType: 'server',
      targetId: server.id,
      metadata: { name: server.name },
      ip: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------- staff */

const staffSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['administrator', 'moderator', 'support']),
  permissions: z.array(z.enum(STAFF_PERMISSIONS)).optional(),
});

router.get(
  '/staff',
  route(async (req, res) => {
    requireOwner(req);
    const rows = db
      .prepare(
        `SELECT s.*, u.username, u.display_name, u.email, p.avatar_media_id AS avatar_media_id, g.display_name AS granted_by_name
           FROM staff_assignments s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN user_profiles p ON p.user_id = u.id
           LEFT JOIN users g ON g.id = s.granted_by
          WHERE s.revoked_at IS NULL
          ORDER BY s.created_at DESC`,
      )
      .all();
    res.json({
      staff: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        email: row.email,
        avatarUrl: row.avatar_media_id ? `/api/media/${row.avatar_media_id}` : null,
        role: row.role,
        permissions: row.permissions ? JSON.parse(row.permissions) : [],
        grantedBy: row.granted_by_name,
        createdAt: row.created_at,
      })),
      roles: STAFF_ROLES,
      available: STAFF_PERMISSIONS,
    });
  }),
);

router.post(
  '/staff',
  route(async (req, res) => {
    requireOwner(req);
    const parsed = staffSchema.safeParse(req.body ?? {});
    if (!parsed.success) fail(400, 'invalid_input', 'Choose a member and a valid staff role.');
    const target = userRow(parsed.data.userId);
    if (target.is_owner) fail(400, 'owner_already', 'The owner already holds every permission.');

    const existing = db
      .prepare('SELECT id FROM staff_assignments WHERE user_id = ? AND revoked_at IS NULL')
      .get(target.id);
    if (existing) {
      db.prepare('UPDATE staff_assignments SET role = ?, permissions = ?, granted_by = ? WHERE id = ?').run(
        parsed.data.role,
        JSON.stringify(parsed.data.permissions ?? []),
        req.user.id,
        existing.id,
      );
    } else {
      db.prepare(
        'INSERT INTO staff_assignments (id, user_id, role, permissions, granted_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(randomUUID(), target.id, parsed.data.role, JSON.stringify(parsed.data.permissions ?? []), req.user.id, nowIso());
    }
    audit(req.user.id, 'admin.staff_granted', {
      targetType: 'user',
      targetId: target.id,
      metadata: { role: parsed.data.role, permissions: parsed.data.permissions ?? [] },
      ip: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/staff/:id',
  route(async (req, res) => {
    requireOwner(req);
    const row = db.prepare('SELECT * FROM staff_assignments WHERE id = ?').get(idParam(req));
    if (!row) fail(404, 'staff_not_found', 'That staff assignment no longer exists.');
    db.prepare('UPDATE staff_assignments SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit(req.user.id, 'admin.staff_revoked', {
      targetType: 'user',
      targetId: row.user_id,
      metadata: { role: row.role },
      ip: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

/* ----------------------------------------------------------------- reports */

router.get(
  '/reports',
  route(async (req, res) => {
    requirePermission(req, 'view.reports');
    const status = String(req.query.status ?? 'open');
    const rows = db
      .prepare(
        `SELECT r.*, rep.display_name AS reporter_name, rep.username AS reporter_username,
                tgt.display_name AS reported_name, tgt.username AS reported_username, s.name AS server_name
           FROM reports r
           LEFT JOIN users rep ON rep.id = r.reporter_id
           LEFT JOIN users tgt ON tgt.id = r.reported_user_id
           LEFT JOIN servers s ON s.id = r.server_id
          WHERE (? = 'all' OR r.status = ?)
          ORDER BY r.created_at DESC LIMIT 100`,
      )
      .all(status, status);
    res.json({
      reports: rows.map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolutionNote: row.resolution_note,
        reporter: row.reporter_name ? { name: row.reporter_name, username: row.reporter_username } : null,
        reported: row.reported_name ? { name: row.reported_name, username: row.reported_username } : null,
        serverName: row.server_name,
      })),
    });
  }),
);

router.post(
  '/reports/:id/resolve',
  route(async (req, res) => {
    requirePermission(req, 'view.reports');
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(idParam(req));
    if (!row) fail(404, 'report_not_found', 'That report no longer exists.');
    const status = req.body?.status === 'dismissed' ? 'dismissed' : 'resolved';
    const note = String(req.body?.note ?? '').trim() || null;
    db.prepare('UPDATE reports SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(
      status,
      note,
      req.user.id,
      nowIso(),
      row.id,
    );
    audit(req.user.id, 'admin.report_resolved', {
      targetType: 'report',
      targetId: row.id,
      metadata: { status, note },
      ip: clientIp(req),
    });
    res.json({ ok: true, status });
  }),
);

/* ---------------------------------------------------------------- settings */

const settingsSchema = z.object({
  appName: z.string().trim().min(2).max(40).optional(),
  announcement: z.string().trim().max(500).optional(),
  registrationOpen: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  uploadLimitMb: z.number().min(1).max(200).optional(),
  moderationEnabled: z.boolean().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Accent colour must be a hex value.')
    .optional(),
});

router.get(
  '/settings',
  route(async (req, res) => {
    requireOwner(req);
    res.json({ settings: appSettings() });
  }),
);

router.patch(
  '/settings',
  route(async (req, res) => {
    requireOwner(req);
    const parsed = settingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      fail(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Check the settings values.');
    }
    if (Object.keys(parsed.data).length === 0) fail(400, 'no_changes', 'Nothing to update.');
    const settings = saveAppSettings(parsed.data, req.user.id);
    audit(req.user.id, 'admin.settings_updated', {
      targetType: 'platform',
      metadata: parsed.data,
      ip: clientIp(req),
    });
    res.json({ ok: true, settings });
  }),
);

/* ------------------------------------------------------------------- audit */

router.get(
  '/audit',
  route(async (req, res) => {
    requirePermission(req, 'view.audit');
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const query = String(req.query.query ?? '').trim().toLowerCase();
    const like = `%${query}%`;
    const rows = db
      .prepare(
        `SELECT l.*, u.display_name AS actor_name, u.username AS actor_username
           FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
          WHERE (? = '' OR lower(l.action) LIKE ? OR lower(COALESCE(u.username, '')) LIKE ?)
          ORDER BY l.created_at DESC LIMIT ?`,
      )
      .all(query, like, like, limit);
    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        actorName: row.actor_name,
        actorUsername: row.actor_username,
        targetType: row.target_type,
        targetId: row.target_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        ip: row.ip,
        createdAt: row.created_at,
      })),
    });
  }),
);

/* ------------------------------------------------------- channels & content */

/** Read-only channel inventory for the owner console. */
router.get(
  '/channels',
  route(async (req, res) => {
    requirePermission(req, 'manage.servers');
    const query = String(req.query.query ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const like = `%${query}%`;
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.type, c.topic, c.is_private, c.read_only, c.slowmode_seconds, c.created_at,
                s.id AS server_id, s.name AS server_name, s.is_suspended,
                cat.name AS category_name,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id AND m.deleted_at IS NULL)
                  AS message_count
           FROM server_channels c
           JOIN servers s ON s.id = c.server_id
           LEFT JOIN server_categories cat ON cat.id = c.category_id
          WHERE (? = '' OR lower(c.name) LIKE ? OR lower(s.name) LIKE ?)
          ORDER BY s.name COLLATE NOCASE, c.position, c.name COLLATE NOCASE
          LIMIT ?`,
      )
      .all(query, like, like, limit);
    res.json({
      total: count('SELECT COUNT(*) AS n FROM server_channels'),
      channels: rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        topic: row.topic,
        isPrivate: Boolean(row.is_private),
        readOnly: Boolean(row.read_only),
        slowmodeSeconds: row.slowmode_seconds,
        createdAt: row.created_at,
        serverId: row.server_id,
        serverName: row.server_name,
        serverSuspended: Boolean(row.is_suspended),
        categoryName: row.category_name,
        messageCount: row.message_count,
      })),
    });
  }),
);

/** Recent message inventory (never exposes private content to non-staff). */
router.get(
  '/messages',
  route(async (req, res) => {
    requirePermission(req, 'moderate.messages');
    const query = String(req.query.query ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const like = `%${query}%`;
    const rows = db
      .prepare(
        `SELECT m.id, m.body, m.created_at, m.edited_at, m.pinned_at,
                u.id AS author_id, u.display_name AS author_name, u.username AS author_username,
                conv.kind, conv.title,
                sc.name AS channel_name, s.name AS server_name,
                (SELECT COUNT(*) FROM message_attachments a WHERE a.message_id = m.id) AS attachment_count,
                (SELECT COUNT(*) FROM message_reactions r WHERE r.message_id = m.id) AS reaction_count
           FROM messages m
           JOIN conversations conv ON conv.id = m.conversation_id
           LEFT JOIN users u ON u.id = m.author_id
           LEFT JOIN server_channels sc ON sc.conversation_id = conv.id
           LEFT JOIN servers s ON s.id = sc.server_id
          WHERE m.deleted_at IS NULL
            AND (? = '' OR lower(m.body) LIKE ? OR lower(COALESCE(u.username, '')) LIKE ?)
          ORDER BY m.created_at DESC
          LIMIT ?`,
      )
      .all(query, like, like, limit);
    res.json({
      total: count('SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL'),
      messages: rows.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
        editedAt: row.edited_at,
        pinned: Boolean(row.pinned_at),
        authorId: row.author_id,
        authorName: row.author_name,
        authorUsername: row.author_username,
        kind: row.kind,
        title: row.title,
        channelName: row.channel_name,
        serverName: row.server_name,
        attachmentCount: row.attachment_count,
        reactionCount: row.reaction_count,
      })),
    });
  }),
);

/** Platform-wide moderation history across every moderated account. */
router.get(
  '/moderation',
  route(async (req, res) => {
    requirePermission(req, 'view.audit');
    const query = String(req.query.query ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const like = `%${query}%`;
    const rows = db
      .prepare(
        `SELECT pm.id, pm.action, pm.reason, pm.expires_at, pm.created_at,
                a.display_name AS actor_name, a.username AS actor_username,
                t.id AS target_id, t.display_name AS target_name, t.username AS target_username
           FROM platform_moderation pm
           LEFT JOIN users a ON a.id = pm.actor_id
           LEFT JOIN users t ON t.id = pm.target_user_id
          WHERE (? = '' OR lower(pm.action) LIKE ? OR lower(COALESCE(t.username, '')) LIKE ?)
          ORDER BY pm.created_at DESC
          LIMIT ?`,
      )
      .all(query, like, like, limit);
    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        actorName: row.actor_name,
        actorUsername: row.actor_username,
        targetId: row.target_id,
        targetName: row.target_name,
        targetUsername: row.target_username,
      })),
    });
  }),
);

export default router;
