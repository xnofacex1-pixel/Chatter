import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { db, nowIso, transaction, uploadsPath } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { publicUser } from '../lib/presenters.js';
import { rateLimit } from '../lib/rate-limit.js';
import { publish } from '../lib/realtime.js';
import { audit } from '../lib/sessions.js';
import { requireUser } from './me.js';
import { joinServer, leaveServer } from '../lib/membership.js';
import {
  ALL_PERMISSIONS,
  DEFAULT_MEMBER_PERMISSIONS,
  MODERATOR_PERMISSIONS,
  P,
  PERMISSION_LIST,
  assertCanActOnMember,
  basePermissions,
  channelPermissions,
  defaultRole,
  has,
  isPlatformOwner,
  memberRow,
  memberRoles,
  requirePermission,
  requireServer,
  requireServerMember,
  rolesOfServer,
  serializeChannel,
  serializeRole,
  serverMemberIds,
  serverSettingsRow,
  serverSummary,
  topPosition,
} from '../lib/server-perms.js';

export const router = Router();

router.use(requireUser);
router.use((req, _res, next) => {
  req.rateLimitKey = req.user.id;
  next();
});

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'form',
      message: issue.message,
    }));
    fail(400, 'validation_failed', fields[0]?.message ?? 'Check the values you entered.', { fields });
  }
  return result.data;
}

const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function storeImage(file, ownerId, kind) {
  if (!file) fail(400, 'no_file', 'Choose an image to upload.');
  const extension = IMAGE_TYPES[file.mimetype];
  if (!extension) fail(415, 'unsupported_type', 'Upload a PNG, JPEG, WebP or GIF image.');
  if (!file.size) fail(400, 'empty_file', 'That image is empty.');
  const id = randomUUID();
  const filename = `${kind}-${id}.${extension}`;
  fs.writeFileSync(path.join(uploadsPath, filename), file.buffer, { mode: 0o600 });
  db.prepare(
    `INSERT INTO media (id, owner_id, kind, mime, byte_size, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, ownerId, kind, file.mimetype, file.size, filename, nowIso());
  return id;
}

function dropMedia(mediaId) {
  if (!mediaId) return;
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
  if (!row) return;
  try {
    fs.unlinkSync(path.join(uploadsPath, row.storage_path));
  } catch {
    /* file already gone */
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);
}

function createRoleRow(serverId, { name, color = '#8b9bb4', permissions, position = 0, isDefault = false }) {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO server_roles (id, server_id, name, color, permissions, position, is_default, is_system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, serverId, name, color, permissions, position, isDefault ? 1 : 0, now, now);
  return id;
}

function createChannelRow(serverId, data) {
  const id = randomUUID();
  const now = nowIso();
  const conversationId = data.type === 'text' ? randomUUID() : null;
  db.prepare(
    `INSERT INTO server_channels
       (id, server_id, category_id, conversation_id, name, type, topic, position,
        is_private, read_only, slowmode_seconds, user_limit, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    serverId,
    data.categoryId ?? null,
    conversationId,
    data.name,
    data.type,
    data.topic ?? null,
    data.position ?? 0,
    data.isPrivate ? 1 : 0,
    data.readOnly ? 1 : 0,
    data.slowmodeSeconds ?? 0,
    data.userLimit ?? null,
    now,
    now,
  );
  if (conversationId) {
    db.prepare(
      `INSERT INTO conversations (id, kind, channel_id, title, created_by, created_at, updated_at)
       VALUES (?, 'channel', ?, ?, ?, ?, ?)`,
    ).run(conversationId, id, data.name, data.createdBy ?? null, now, now);
  }
  return { id, conversationId };
}

function createCategoryRow(serverId, name, position) {
  const id = randomUUID();
  db.prepare('INSERT INTO server_categories (id, server_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    serverId,
    name,
    position,
    nowIso(),
  );
  return id;
}

function setChannelPrivacy(channelId, serverId, isPrivate) {
  const everyone = defaultRole(serverId);
  if (!everyone) return;
  if (isPrivate) {
    db.prepare(
      `INSERT INTO server_channel_overwrites (channel_id, target_type, target_id, allow, deny)
       VALUES (?, 'role', ?, 0, ?)
       ON CONFLICT(channel_id, target_type, target_id) DO UPDATE SET deny = excluded.deny`,
    ).run(channelId, everyone.id, P.VIEW_CHANNEL);
  } else {
    db.prepare(
      `DELETE FROM server_channel_overwrites
        WHERE channel_id = ? AND target_type = 'role' AND target_id = ? AND allow = 0 AND deny = ?`,
    ).run(channelId, everyone.id, P.VIEW_CHANNEL);
  }
}

function moderationEntry(serverId, actorId, targetId, action, { reason = null, expiresAt = null } = {}) {
  db.prepare(
    `INSERT INTO server_moderation (id, server_id, actor_id, target_user_id, action, reason, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), serverId, actorId, targetId, action, reason, expiresAt, nowIso());
}

function notifyServerMembers(serverId, event, data) {
  publish(serverMemberIds(serverId), event, data);
}

function unreadFor(channel, userId) {
  if (!channel.conversation_id) return 0;
  const lastRead =
    db
      .prepare('SELECT last_read_at FROM channel_reads WHERE channel_id = ? AND user_id = ?')
      .get(channel.id, userId)?.last_read_at ?? '1970-01-01T00:00:00.000Z';
  return db
    .prepare(
      `SELECT COUNT(*) AS total FROM messages
        WHERE conversation_id = ? AND created_at > ? AND author_id <> ? AND deleted_at IS NULL`,
    )
    .get(channel.conversation_id, lastRead, userId).total;
}

function assertGrantable(serverId, actorId, permissions) {
  const actorPermissions = basePermissions(serverId, actorId);
  if (actorPermissions === ALL_PERMISSIONS) return;
  if ((permissions & ~actorPermissions) !== 0) {
    fail(403, 'permission_escalation', 'You cannot grant permissions you do not have.');
  }
}

function assertRoleManageable(serverId, role, actorId) {
  if (role.is_default) {
    fail(400, 'default_role', 'The @everyone role cannot be renamed or deleted.');
  }
  const actorTop = topPosition(serverId, actorId);
  if (role.position >= actorTop) {
    fail(403, 'role_hierarchy', 'That role is equal to or above your highest role.');
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/* -------------------------------------------------------------------------- */
/* servers                                                                     */
/* -------------------------------------------------------------------------- */

const createServerSchema = z.object({
  name: z.string().trim().min(2, 'Community names need at least 2 characters.').max(48),
  description: z.string().trim().max(280).optional(),
  isPublic: z.boolean().optional(),
});

router.post(
  '/',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 6, keyPrefix: 'server-create' }),
  route(async (req, res) => {
    const data = parseBody(createServerSchema, req.body);
    const userId = req.user.id;
    const serverId = randomUUID();
    const now = nowIso();

    transaction(() => {
      db.prepare(
        `INSERT INTO servers (id, name, description, owner_id, is_public, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(serverId, data.name, data.description ?? null, userId, data.isPublic === false ? 0 : 1, now, now);
      db.prepare(
        'INSERT INTO server_settings (server_id, default_notification_level) VALUES (?, ?)',
      ).run(serverId, 'all');
      db.prepare('INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(
        serverId,
        userId,
        now,
      );
      createRoleRow(serverId, {
        name: '@everyone',
        color: '#8b9bb4',
        permissions: DEFAULT_MEMBER_PERMISSIONS,
        position: 0,
        isDefault: true,
      });
      createRoleRow(serverId, {
        name: 'Moderator',
        color: '#38bdf8',
        permissions: MODERATOR_PERMISSIONS,
        position: 1,
      });
      createRoleRow(serverId, {
        name: 'Administrator',
        color: '#f59e0b',
        permissions: P.ADMINISTRATOR,
        position: 2,
      });

      const startHere = createCategoryRow(serverId, 'Start here', 0);
      const voice = createCategoryRow(serverId, 'Voice', 1);
      createChannelRow(serverId, {
        name: 'general',
        type: 'text',
        categoryId: startHere,
        position: 0,
        topic: 'Say hello to your community.',
        createdBy: userId,
      });
      createChannelRow(serverId, {
        name: 'announcements',
        type: 'text',
        categoryId: startHere,
        position: 1,
        topic: 'Community announcements.',
        readOnly: true,
        createdBy: userId,
      });
      createChannelRow(serverId, {
        name: 'Lounge',
        type: 'voice',
        categoryId: voice,
        position: 0,
        userLimit: 0,
      });
    });

    audit(userId, 'server.created', { targetType: 'server', targetId: serverId, ip: clientIp(req) });
    res.status(201).json({ server: serverSummary(requireServer(serverId), userId) });
  }),
);

router.get(
  '/',
  route(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.* FROM servers s
           JOIN server_members m ON m.server_id = s.id AND m.user_id = ?
          ORDER BY s.name COLLATE NOCASE ASC`,
      )
      .all(req.user.id);
    res.json({ servers: rows.map((row) => serverSummary(row, req.user.id)) });
  }),
);

router.get(
  '/discover',
  route(async (req, res) => {
    const query = String(req.query.q ?? '').trim();
    const like = `%${query.toLowerCase()}%`;
    const rows = db
      .prepare(
        `SELECT s.* FROM servers s
          WHERE s.is_public = 1 AND s.is_suspended = 0
            AND NOT EXISTS (SELECT 1 FROM server_members m WHERE m.server_id = s.id AND m.user_id = ?)
            AND (? = '' OR lower(s.name) LIKE ? OR lower(coalesce(s.description, '')) LIKE ?)
          ORDER BY s.created_at DESC
          LIMIT 40`,
      )
      .all(req.user.id, query, like, like);
    res.json({ servers: rows.map((row) => serverSummary(row, req.user.id)) });
  }),
);

router.get(
  '/:id',
  route(async (req, res) => {
    const { server, member } = requireServerMember(req.params.id, req.user.id);
    const userId = req.user.id;
    const permissions = basePermissions(server.id, userId);

    const categories = db
      .prepare('SELECT * FROM server_categories WHERE server_id = ? ORDER BY position ASC, created_at ASC')
      .all(server.id)
      .map((row) => ({ id: row.id, name: row.name, position: row.position }));

    const channelRows = db
      .prepare('SELECT * FROM server_channels WHERE server_id = ? ORDER BY position ASC, created_at ASC')
      .all(server.id);

    const channels = channelRows
      .map((row) => {
        const channel = serializeChannel(row, channelPermissions(server.id, userId, row.id));
        channel.unreadCount = channel.canView ? unreadFor(row, userId) : 0;
        return channel;
      })
      .filter((channel) => channel.canView);

    res.json({
      server: serverSummary(server, userId),
      permissions,
      permissionList: PERMISSION_LIST,
      member: {
        joinedAt: member.joined_at,
        nickname: member.nickname,
        timeoutUntil: member.timeout_until,
        roles: memberRoles(server.id, userId).map(serializeRole),
      },
      roles: rolesOfServer(server.id).map(serializeRole),
      categories,
      channels,
      settings: serverSettingsRow(server.id),
      notificationLevel: db
        .prepare('SELECT level FROM server_notification_prefs WHERE server_id = ? AND user_id = ?')
        .get(server.id, userId)?.level ?? 'all',
      myTopPosition: topPosition(server.id, userId),
    });
  }),
);

const updateServerSchema = z.object({
  name: z.string().trim().min(2).max(48).optional(),
  description: z.string().trim().max(280).nullable().optional(),
  isPublic: z.boolean().optional(),
});

router.patch(
  '/:id',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_SERVER);
    const data = parseBody(updateServerSchema, req.body);
    const fields = [];
    const values = [];
    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push('description = ?');
      values.push(data.description);
    }
    if (data.isPublic !== undefined) {
      fields.push('is_public = ?');
      values.push(data.isPublic ? 1 : 0);
    }
    if (fields.length === 0) fail(400, 'nothing_to_update', 'There is nothing to update.');
    fields.push('updated_at = ?');
    values.push(nowIso(), server.id);
    db.prepare(`UPDATE servers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    audit(req.user.id, 'server.updated', {
      targetType: 'server',
      targetId: server.id,
      metadata: data,
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:updated', { serverId: server.id });
    res.json({ server: serverSummary(requireServer(server.id), req.user.id) });
  }),
);

router.delete(
  '/:id',
  route(async (req, res) => {
    const server = requireServer(req.params.id);
    if (!(server.owner_id === req.user.id || isPlatformOwner(req.user.id))) {
      fail(403, 'owner_only', 'Only the community owner can delete it.');
    }
    const confirm = String(req.body?.confirm ?? req.query.confirm ?? '').trim();
    if (confirm !== server.name) {
      fail(400, 'confirm_required', 'Type the community name exactly to confirm deletion.');
    }
    transaction(() => {
      db.prepare(
        'DELETE FROM conversations WHERE channel_id IN (SELECT id FROM server_channels WHERE server_id = ?)',
      ).run(server.id);
      db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);
    });
    dropMedia(server.icon_media_id);
    dropMedia(server.banner_media_id);
    audit(req.user.id, 'server.deleted', { targetType: 'server', targetId: server.id, ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

function imageRoute(column, kind) {
  return [
    upload.single('image'),
    route(async (req, res) => {
      const { server } = requireServerMember(req.params.id, req.user.id);
      requirePermission(server.id, req.user.id, P.MANAGE_SERVER);
      const mediaId = storeImage(req.file, req.user.id, `server-${kind}`);
      db.prepare(`UPDATE servers SET ${column} = ?, updated_at = ? WHERE id = ?`).run(mediaId, nowIso(), server.id);
      if (server[column] && server[column] !== mediaId) dropMedia(server[column]);
      audit(req.user.id, `server.${kind}_updated`, {
        targetType: 'server',
        targetId: server.id,
        ip: clientIp(req),
      });
      notifyServerMembers(server.id, 'server:updated', { serverId: server.id });
      res.json({ server: serverSummary(requireServer(server.id), req.user.id) });
    }),
  ];
}

router.post('/:id/icon', ...imageRoute('icon_media_id', 'icon'));
router.post('/:id/banner', ...imageRoute('banner_media_id', 'banner'));

function removeImageRoute(column, kind) {
  return route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_SERVER);
    db.prepare(`UPDATE servers SET ${column} = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), server.id);
    dropMedia(server[column]);
    audit(req.user.id, `server.${kind}_removed`, { targetType: 'server', targetId: server.id, ip: clientIp(req) });
    notifyServerMembers(server.id, 'server:updated', { serverId: server.id });
    res.json({ server: serverSummary(requireServer(server.id), req.user.id) });
  });
}

router.delete('/:id/icon', removeImageRoute('icon_media_id', 'icon'));
router.delete('/:id/banner', removeImageRoute('banner_media_id', 'banner'));

router.post(
  '/:id/join',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyPrefix: 'server-join' }),
  route(async (req, res) => {
    const server = requireServer(req.params.id);
    if (!server.is_public) {
      fail(403, 'invite_required', 'This community is private. You need an invite link to join.');
    }
    const result = joinServer(server, req.user.id, { ip: clientIp(req) });
    res.status(result.alreadyMember ? 200 : 201).json({
      server: serverSummary(requireServer(server.id), req.user.id),
      alreadyMember: result.alreadyMember,
    });
  }),
);

router.post(
  '/:id/leave',
  route(async (req, res) => {
    const server = requireServer(req.params.id);
    leaveServer(server, req.user.id, { ip: clientIp(req) });
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------------------- */
/* members                                                                     */
/* -------------------------------------------------------------------------- */

router.get(
  '/:id/members',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.VIEW_CHANNEL);
    const query = String(req.query.q ?? '').trim().toLowerCase();

    const rows = db
      .prepare(
        `SELECT sm.user_id, sm.nickname, sm.joined_at, sm.timeout_until, u.*
           FROM server_members sm JOIN users u ON u.id = sm.user_id
          WHERE sm.server_id = ?`,
      )
      .all(server.id);

    const roleRows = db
      .prepare(
        `SELECT mr.user_id, r.* FROM server_member_roles mr
           JOIN server_roles r ON r.id = mr.role_id
          WHERE mr.server_id = ?`,
      )
      .all(server.id);
    const rolesByUser = new Map();
    for (const role of roleRows) {
      const list = rolesByUser.get(role.user_id) ?? [];
      list.push(role);
      rolesByUser.set(role.user_id, list);
    }

    const members = rows
      .map((row) => {
        const user = publicUser(row);
        const roles = (rolesByUser.get(row.user_id) ?? []).sort((a, b) => b.position - a.position);
        return {
          user,
          nickname: row.nickname,
          joinedAt: row.joined_at,
          timeoutUntil: row.timeout_until,
          roles: roles.map(serializeRole),
          isOwner: server.owner_id === row.user_id,
          topPosition: server.owner_id === row.user_id ? Number.MAX_SAFE_INTEGER : (roles[0]?.position ?? 0),
        };
      })
      .filter((entry) => {
        if (!query) return true;
        return (
          entry.user.username.toLowerCase().includes(query) ||
          entry.user.displayName.toLowerCase().includes(query) ||
          (entry.nickname ?? '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.topPosition - a.topPosition || a.user.displayName.localeCompare(b.user.displayName));

    res.json({ members });
  }),
);

const updateMemberSchema = z.object({
  nickname: z.string().trim().max(32).nullable().optional(),
  roleIds: z.array(z.string().min(1)).max(32).optional(),
});

router.patch(
  '/:id/members/:userId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    const targetId = req.params.userId;
    const target = memberRow(server.id, targetId);
    if (!target) fail(404, 'member_not_found', 'That member is not in this community.');
    const data = parseBody(updateMemberSchema, req.body);

    if (data.nickname !== undefined) {
      requirePermission(server.id, req.user.id, P.MANAGE_NICKNAMES);
      assertCanActOnMember(server, req.user.id, targetId);
      db.prepare('UPDATE server_members SET nickname = ? WHERE server_id = ? AND user_id = ?').run(
        data.nickname || null,
        server.id,
        targetId,
      );
      moderationEntry(server.id, req.user.id, targetId, 'nickname_changed', { reason: data.nickname ?? null });
    }

    if (data.roleIds !== undefined) {
      requirePermission(server.id, req.user.id, P.MANAGE_ROLES);
      assertCanActOnMember(server, req.user.id, targetId);
      const actorTop = topPosition(server.id, req.user.id);
      const validRoles = [];
      for (const roleId of data.roleIds) {
        const role = db.prepare('SELECT * FROM server_roles WHERE id = ? AND server_id = ?').get(roleId, server.id);
        if (!role) fail(400, 'invalid_role', 'One of those roles no longer exists.');
        if (role.is_default) fail(400, 'invalid_role', 'The @everyone role is implicit and cannot be assigned.');
        if (role.position >= actorTop) {
          fail(403, 'role_hierarchy', 'You cannot assign a role equal to or above your highest role.');
        }
        assertGrantable(server.id, req.user.id, role.permissions);
        validRoles.push(role.id);
      }
      transaction(() => {
        db.prepare('DELETE FROM server_member_roles WHERE server_id = ? AND user_id = ?').run(server.id, targetId);
        const insert = db.prepare(
          'INSERT OR IGNORE INTO server_member_roles (server_id, user_id, role_id, assigned_at) VALUES (?, ?, ?, ?)',
        );
        for (const roleId of validRoles) insert.run(server.id, targetId, roleId, nowIso());
      });
      moderationEntry(server.id, req.user.id, targetId, 'roles_updated', {
        reason: validRoles.length ? validRoles.join(',') : 'no roles',
      });
    }

    audit(req.user.id, 'server.member_updated', {
      targetType: 'user',
      targetId,
      metadata: { serverId: server.id },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:member_updated', { serverId: server.id, userId: targetId });

    const refreshed = db
      .prepare('SELECT sm.user_id, sm.nickname, sm.joined_at, sm.timeout_until, u.* FROM server_members sm JOIN users u ON u.id = sm.user_id WHERE sm.server_id = ? AND sm.user_id = ?')
      .get(server.id, targetId);
    res.json({
      member: {
        user: publicUser(refreshed),
        nickname: refreshed.nickname,
        joinedAt: refreshed.joined_at,
        timeoutUntil: refreshed.timeout_until,
        roles: memberRoles(server.id, targetId).map(serializeRole),
        isOwner: server.owner_id === targetId,
      },
    });
  }),
);

const reasonSchema = z.object({ reason: z.string().trim().max(400).optional() });

router.post(
  '/:id/members/:userId/kick',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.KICK_MEMBERS);
    const targetId = req.params.userId;
    assertCanActOnMember(server, req.user.id, targetId);
    const data = parseBody(reasonSchema, req.body);
    transaction(() => {
      db.prepare('DELETE FROM server_member_roles WHERE server_id = ? AND user_id = ?').run(server.id, targetId);
      db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(server.id, targetId);
    });
    moderationEntry(server.id, req.user.id, targetId, 'kick', { reason: data.reason ?? null });
    audit(req.user.id, 'server.member_kicked', {
      targetType: 'user',
      targetId,
      metadata: { serverId: server.id },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:member_left', { serverId: server.id, userId: targetId });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/members/:userId/ban',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.BAN_MEMBERS);
    const targetId = req.params.userId;
    assertCanActOnMember(server, req.user.id, targetId);
    const data = parseBody(reasonSchema, req.body);
    transaction(() => {
      db.prepare(
        `INSERT INTO server_bans (server_id, user_id, actor_id, reason, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_id, user_id) DO UPDATE SET reason = excluded.reason, actor_id = excluded.actor_id`,
      ).run(server.id, targetId, req.user.id, data.reason ?? null, nowIso());
      db.prepare('DELETE FROM server_member_roles WHERE server_id = ? AND user_id = ?').run(server.id, targetId);
      db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(server.id, targetId);
    });
    moderationEntry(server.id, req.user.id, targetId, 'ban', { reason: data.reason ?? null });
    audit(req.user.id, 'server.member_banned', {
      targetType: 'user',
      targetId,
      metadata: { serverId: server.id },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:member_left', { serverId: server.id, userId: targetId });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id/bans/:userId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.BAN_MEMBERS);
    db.prepare('DELETE FROM server_bans WHERE server_id = ? AND user_id = ?').run(server.id, req.params.userId);
    moderationEntry(server.id, req.user.id, req.params.userId, 'unban');
    res.json({ ok: true });
  }),
);

const timeoutSchema = z.object({
  minutes: z.number().int().min(1).max(40_320),
  reason: z.string().trim().max(400).optional(),
});

router.post(
  '/:id/members/:userId/timeout',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.TIMEOUT_MEMBERS);
    const targetId = req.params.userId;
    assertCanActOnMember(server, req.user.id, targetId);
    const data = parseBody(timeoutSchema, req.body);
    const until = new Date(Date.now() + data.minutes * 60_000).toISOString();
    db.prepare('UPDATE server_members SET timeout_until = ? WHERE server_id = ? AND user_id = ?').run(
      until,
      server.id,
      targetId,
    );
    moderationEntry(server.id, req.user.id, targetId, 'timeout', { reason: data.reason ?? null, expiresAt: until });
    notifyServerMembers(server.id, 'server:member_updated', { serverId: server.id, userId: targetId });
    res.json({ ok: true, timeoutUntil: until });
  }),
);

router.get(
  '/:id/moderation',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.VIEW_AUDIT_LOG);
    const rows = db
      .prepare(
        `SELECT m.*, a.username AS actor_username, a.display_name AS actor_name,
                t.username AS target_username, t.display_name AS target_name
           FROM server_moderation m
           LEFT JOIN users a ON a.id = m.actor_id
           LEFT JOIN users t ON t.id = m.target_user_id
          WHERE m.server_id = ?
          ORDER BY m.created_at DESC LIMIT 100`,
      )
      .all(server.id);
    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        actor: row.actor_id ? { id: row.actor_id, username: row.actor_username, displayName: row.actor_name } : null,
        target: row.target_user_id
          ? { id: row.target_user_id, username: row.target_username, displayName: row.target_name }
          : null,
      })),
    });
  }),
);

const notificationSchema = z.object({ level: z.enum(['all', 'mentions', 'none']) });

router.patch(
  '/:id/notifications',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    const data = parseBody(notificationSchema, req.body);
    db.prepare(
      `INSERT INTO server_notification_prefs (server_id, user_id, level, muted_until) VALUES (?, ?, ?, NULL)
       ON CONFLICT(server_id, user_id) DO UPDATE SET level = excluded.level, muted_until = NULL`,
    ).run(server.id, req.user.id, data.level);
    res.json({ level: data.level });
  }),
);

router.post(
  '/:id/transfer',
  route(async (req, res) => {
    const server = requireServer(req.params.id);
    if (server.owner_id !== req.user.id && !isPlatformOwner(req.user.id)) {
      fail(403, 'owner_only', 'Only the community owner can transfer ownership.');
    }
    const data = parseBody(z.object({ userId: z.string().min(1) }), req.body);
    const target = memberRow(server.id, data.userId);
    if (!target) fail(400, 'member_not_found', 'Choose a member of this community.');
    db.prepare('UPDATE servers SET owner_id = ?, updated_at = ? WHERE id = ?').run(data.userId, nowIso(), server.id);
    moderationEntry(server.id, req.user.id, data.userId, 'ownership_transferred');
    audit(req.user.id, 'server.ownership_transferred', {
      targetType: 'user',
      targetId: data.userId,
      metadata: { serverId: server.id },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:updated', { serverId: server.id });
    res.json({ server: serverSummary(requireServer(server.id), req.user.id) });
  }),
);

/* -------------------------------------------------------------------------- */
/* roles                                                                       */
/* -------------------------------------------------------------------------- */

router.get(
  '/:id/roles',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    res.json({
      roles: rolesOfServer(server.id).map(serializeRole),
      permissionList: PERMISSION_LIST,
      myTopPosition: topPosition(server.id, req.user.id),
    });
  }),
);

const roleSchema = z.object({
  name: z.string().trim().min(1).max(32),
  color: z.string().regex(HEX, 'Use a hex colour such as #38bdf8.').optional(),
  permissions: z.number().int().min(0).max(ALL_PERMISSIONS).optional(),
});

router.post(
  '/:id/roles',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_ROLES);
    const data = parseBody(roleSchema, req.body);
    const permissions = data.permissions ?? 0;
    assertGrantable(server.id, req.user.id, permissions);
    const actorTop = topPosition(server.id, req.user.id);
    const highest = rolesOfServer(server.id).reduce((max, role) => Math.max(max, role.position), 0);
    const position = Math.max(1, Math.min(actorTop - 1, highest + 1));
    if (position >= actorTop) fail(403, 'role_hierarchy', 'You cannot create a role above your own.');
    const roleId = createRoleRow(server.id, {
      name: data.name,
      color: data.color ?? '#8b9bb4',
      permissions,
      position,
    });
    audit(req.user.id, 'server.role_created', {
      targetType: 'server',
      targetId: server.id,
      metadata: { roleId },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:roles_updated', { serverId: server.id });
    res.status(201).json({ role: serializeRole(db.prepare('SELECT * FROM server_roles WHERE id = ?').get(roleId)) });
  }),
);

const roleOrderSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), position: z.number().int().min(0).max(1000) })).min(1).max(100),
});

router.patch(
  '/:id/roles/order',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_ROLES);
    const data = parseBody(roleOrderSchema, req.body);
    const actorTop = topPosition(server.id, req.user.id);
    transaction(() => {
      for (const item of data.items) {
        const role = db.prepare('SELECT * FROM server_roles WHERE id = ? AND server_id = ?').get(item.id, server.id);
        if (!role) continue;
        if (role.is_default) continue;
        if (role.position >= actorTop || item.position >= actorTop) continue;
        db.prepare('UPDATE server_roles SET position = ?, updated_at = ? WHERE id = ?').run(
          item.position,
          nowIso(),
          role.id,
        );
      }
    });
    notifyServerMembers(server.id, 'server:roles_updated', { serverId: server.id });
    res.json({ roles: rolesOfServer(server.id).map(serializeRole) });
  }),
);

router.patch(
  '/:id/roles/:roleId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_ROLES);
    const role = db
      .prepare('SELECT * FROM server_roles WHERE id = ? AND server_id = ?')
      .get(req.params.roleId, server.id);
    if (!role) fail(404, 'role_not_found', 'That role no longer exists.');
    const data = parseBody(roleSchema.partial(), req.body);

    if (!role.is_default) assertRoleManageable(server.id, role, req.user.id);
    if (role.is_default && data.name !== undefined) {
      fail(400, 'default_role', 'The @everyone role keeps its name.');
    }
    if (data.permissions !== undefined) {
      if (role.permissions === P.ADMINISTRATOR && !isPlatformOwner(req.user.id)) {
        assertGrantable(server.id, req.user.id, data.permissions);
      }
      assertGrantable(server.id, req.user.id, data.permissions);
    }

    const fields = [];
    const values = [];
    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.color !== undefined) {
      fields.push('color = ?');
      values.push(data.color);
    }
    if (data.permissions !== undefined) {
      fields.push('permissions = ?');
      values.push(data.permissions);
    }
    if (fields.length === 0) fail(400, 'nothing_to_update', 'There is nothing to update.');
    fields.push('updated_at = ?');
    values.push(nowIso(), role.id);
    db.prepare(`UPDATE server_roles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    audit(req.user.id, 'server.role_updated', {
      targetType: 'server',
      targetId: server.id,
      metadata: { roleId: role.id, changes: data },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:roles_updated', { serverId: server.id });
    res.json({ role: serializeRole(db.prepare('SELECT * FROM server_roles WHERE id = ?').get(role.id)) });
  }),
);

router.delete(
  '/:id/roles/:roleId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_ROLES);
    const role = db
      .prepare('SELECT * FROM server_roles WHERE id = ? AND server_id = ?')
      .get(req.params.roleId, server.id);
    if (!role) fail(404, 'role_not_found', 'That role no longer exists.');
    assertRoleManageable(server.id, role, req.user.id);
    db.prepare('DELETE FROM server_roles WHERE id = ?').run(role.id);
    audit(req.user.id, 'server.role_deleted', {
      targetType: 'server',
      targetId: server.id,
      metadata: { roleId: role.id },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:roles_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------------------- */
/* categories and channels                                                     */
/* -------------------------------------------------------------------------- */

const categorySchema = z.object({
  name: z.string().trim().min(1).max(48),
  position: z.number().int().min(0).max(1000).optional(),
});

router.post(
  '/:id/categories',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const data = parseBody(categorySchema, req.body);
    const highest = db
      .prepare('SELECT MAX(position) AS max FROM server_categories WHERE server_id = ?')
      .get(server.id).max;
    const id = createCategoryRow(server.id, data.name, data.position ?? (highest ?? -1) + 1);
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.status(201).json({ category: { id, name: data.name, position: data.position ?? (highest ?? -1) + 1 } });
  }),
);

router.patch(
  '/:id/categories/:categoryId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const data = parseBody(categorySchema.partial(), req.body);
    const category = db
      .prepare('SELECT * FROM server_categories WHERE id = ? AND server_id = ?')
      .get(req.params.categoryId, server.id);
    if (!category) fail(404, 'category_not_found', 'That category no longer exists.');
    const fields = [];
    const values = [];
    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.position !== undefined) {
      fields.push('position = ?');
      values.push(data.position);
    }
    if (fields.length === 0) fail(400, 'nothing_to_update', 'There is nothing to update.');
    values.push(category.id);
    db.prepare(`UPDATE server_categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id/categories/:categoryId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    db.prepare('UPDATE server_channels SET category_id = NULL WHERE category_id = ?').run(req.params.categoryId);
    db.prepare('DELETE FROM server_categories WHERE id = ? AND server_id = ?').run(req.params.categoryId, server.id);
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

const channelSchema = z.object({
  name: z.string().trim().min(1).max(48),
  type: z.enum(['text', 'voice']),
  categoryId: z.string().nullable().optional(),
  topic: z.string().trim().max(1024).nullable().optional(),
  isPrivate: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  slowmodeSeconds: z.number().int().min(0).max(21_600).optional(),
  userLimit: z.number().int().min(0).max(99).nullable().optional(),
});

function normalizeChannelName(name, type) {
  if (type === 'voice') return name.trim().slice(0, 48);
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 32) || 'channel'
  );
}

router.post(
  '/:id/channels',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, keyPrefix: 'channel-create' }),
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const data = parseBody(channelSchema, req.body);
    if (data.categoryId) {
      const category = db
        .prepare('SELECT id FROM server_categories WHERE id = ? AND server_id = ?')
        .get(data.categoryId, server.id);
      if (!category) fail(400, 'invalid_category', 'That category no longer exists.');
    }
    const highest = db
      .prepare('SELECT MAX(position) AS max FROM server_channels WHERE server_id = ?')
      .get(server.id).max;
    const created = createChannelRow(server.id, {
      name: normalizeChannelName(data.name, data.type),
      type: data.type,
      categoryId: data.categoryId ?? null,
      topic: data.topic ?? null,
      position: (highest ?? -1) + 1,
      isPrivate: data.isPrivate ?? false,
      readOnly: data.readOnly ?? false,
      slowmodeSeconds: data.slowmodeSeconds ?? 0,
      userLimit: data.type === 'voice' ? (data.userLimit ?? 0) : null,
      createdBy: req.user.id,
    });
    if (data.isPrivate) setChannelPrivacy(created.id, server.id, true);
    audit(req.user.id, 'server.channel_created', {
      targetType: 'server',
      targetId: server.id,
      metadata: { channelId: created.id, type: data.type },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.status(201).json({ channelId: created.id, conversationId: created.conversationId });
  }),
);

router.patch(
  '/:id/channels/order',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const data = parseBody(
      z.object({
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              position: z.number().int().min(0).max(1000),
              categoryId: z.string().nullable().optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
      req.body,
    );
    transaction(() => {
      for (const item of data.items) {
        const channel = db
          .prepare('SELECT id FROM server_channels WHERE id = ? AND server_id = ?')
          .get(item.id, server.id);
        if (!channel) continue;
        if (item.categoryId !== undefined) {
          db.prepare('UPDATE server_channels SET position = ?, category_id = ?, updated_at = ? WHERE id = ?').run(
            item.position,
            item.categoryId,
            nowIso(),
            item.id,
          );
        } else {
          db.prepare('UPDATE server_channels SET position = ?, updated_at = ? WHERE id = ?').run(
            item.position,
            nowIso(),
            item.id,
          );
        }
      }
    });
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

const channelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  topic: z.string().trim().max(1024).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
  isPrivate: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  slowmodeSeconds: z.number().int().min(0).max(21_600).optional(),
  userLimit: z.number().int().min(0).max(99).nullable().optional(),
});

router.patch(
  '/:id/channels/:channelId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const channel = db
      .prepare('SELECT * FROM server_channels WHERE id = ? AND server_id = ?')
      .get(req.params.channelId, server.id);
    if (!channel) fail(404, 'channel_not_found', 'That channel no longer exists.');
    const data = parseBody(channelUpdateSchema, req.body);

    const fields = [];
    const values = [];
    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(normalizeChannelName(data.name, channel.type));
    }
    if (data.topic !== undefined) {
      fields.push('topic = ?');
      values.push(data.topic);
    }
    if (data.categoryId !== undefined) {
      fields.push('category_id = ?');
      values.push(data.categoryId);
    }
    if (data.position !== undefined) {
      fields.push('position = ?');
      values.push(data.position);
    }
    if (data.isPrivate !== undefined) {
      fields.push('is_private = ?');
      values.push(data.isPrivate ? 1 : 0);
    }
    if (data.readOnly !== undefined) {
      fields.push('read_only = ?');
      values.push(data.readOnly ? 1 : 0);
    }
    if (data.slowmodeSeconds !== undefined) {
      fields.push('slowmode_seconds = ?');
      values.push(data.slowmodeSeconds);
    }
    if (data.userLimit !== undefined && channel.type === 'voice') {
      fields.push('user_limit = ?');
      values.push(data.userLimit);
    }
    if (fields.length === 0) fail(400, 'nothing_to_update', 'There is nothing to update.');
    fields.push('updated_at = ?');
    values.push(nowIso(), channel.id);
    db.prepare(`UPDATE server_channels SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    if (data.isPrivate !== undefined) setChannelPrivacy(channel.id, server.id, data.isPrivate);
    if (data.name !== undefined && channel.conversation_id) {
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(
        normalizeChannelName(data.name, channel.type),
        channel.conversation_id,
      );
    }
    audit(req.user.id, 'server.channel_updated', {
      targetType: 'server',
      targetId: server.id,
      metadata: { channelId: channel.id, changes: data },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id/channels/:channelId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const channel = db
      .prepare('SELECT * FROM server_channels WHERE id = ? AND server_id = ?')
      .get(req.params.channelId, server.id);
    if (!channel) fail(404, 'channel_not_found', 'That channel no longer exists.');
    transaction(() => {
      if (channel.conversation_id) {
        db.prepare('DELETE FROM conversations WHERE id = ?').run(channel.conversation_id);
      }
      db.prepare('DELETE FROM server_channels WHERE id = ?').run(channel.id);
    });
    audit(req.user.id, 'server.channel_deleted', {
      targetType: 'server',
      targetId: server.id,
      metadata: { channelId: channel.id },
      ip: clientIp(req),
    });
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

router.get(
  '/:id/channels/:channelId/overwrites',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const channel = db
      .prepare('SELECT id FROM server_channels WHERE id = ? AND server_id = ?')
      .get(req.params.channelId, server.id);
    if (!channel) fail(404, 'channel_not_found', 'That channel no longer exists.');
    const rows = db.prepare('SELECT * FROM server_channel_overwrites WHERE channel_id = ?').all(channel.id);
    res.json({
      overwrites: rows.map((row) => ({
        targetType: row.target_type,
        targetId: row.target_id,
        allow: row.allow,
        deny: row.deny,
      })),
    });
  }),
);

const overwriteSchema = z.object({
  targetType: z.enum(['role', 'member']),
  targetId: z.string().min(1),
  allow: z.number().int().min(0).max(ALL_PERMISSIONS),
  deny: z.number().int().min(0).max(ALL_PERMISSIONS),
});

router.put(
  '/:id/channels/:channelId/overwrites',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    const channel = db
      .prepare('SELECT id FROM server_channels WHERE id = ? AND server_id = ?')
      .get(req.params.channelId, server.id);
    if (!channel) fail(404, 'channel_not_found', 'That channel no longer exists.');
    const data = parseBody(overwriteSchema, req.body);
    assertGrantable(server.id, req.user.id, data.allow);

    if (data.targetType === 'role') {
      const role = db
        .prepare('SELECT * FROM server_roles WHERE id = ? AND server_id = ?')
        .get(data.targetId, server.id);
      if (!role) fail(400, 'invalid_role', 'That role no longer exists.');
      if (!role.is_default) assertRoleManageable(server.id, role, req.user.id);
    } else if (!memberRow(server.id, data.targetId)) {
      fail(400, 'member_not_found', 'That member is not in this community.');
    }

    db.prepare(
      `INSERT INTO server_channel_overwrites (channel_id, target_type, target_id, allow, deny)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, target_type, target_id)
       DO UPDATE SET allow = excluded.allow, deny = excluded.deny`,
    ).run(channel.id, data.targetType, data.targetId, data.allow, data.deny);
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id/channels/:channelId/overwrites/:targetType/:targetId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_CHANNELS);
    db.prepare(
      'DELETE FROM server_channel_overwrites WHERE channel_id = ? AND target_type = ? AND target_id = ?',
    ).run(req.params.channelId, req.params.targetType, req.params.targetId);
    notifyServerMembers(server.id, 'server:channels_updated', { serverId: server.id });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/channels/:channelId/read',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    const channel = db
      .prepare('SELECT * FROM server_channels WHERE id = ? AND server_id = ?')
      .get(req.params.channelId, server.id);
    if (!channel) fail(404, 'channel_not_found', 'That channel no longer exists.');
    requirePermission(server.id, req.user.id, P.VIEW_CHANNEL, channel.id);
    db.prepare(
      `INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?, ?, ?)
       ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    ).run(channel.id, req.user.id, nowIso());
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------------------- */
/* invites                                                                     */
/* -------------------------------------------------------------------------- */

const inviteSchema = z.object({
  channelId: z.string().nullable().optional(),
  expiresInHours: z.number().int().min(0).max(720).optional(),
  maxUses: z.number().int().min(0).max(100).optional(),
});

function inviteCode() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

router.post(
  '/:id/invites',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 40, keyPrefix: 'invite-create' }),
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.CREATE_INVITES);
    const data = parseBody(inviteSchema, req.body);
    if (data.channelId) {
      const channel = db
        .prepare('SELECT * FROM server_channels WHERE id = ? AND server_id = ?')
        .get(data.channelId, server.id);
      if (!channel) fail(400, 'invalid_channel', 'That channel no longer exists.');
      requirePermission(server.id, req.user.id, P.VIEW_CHANNEL, channel.id);
    }
    const expiresAt = data.expiresInHours
      ? new Date(Date.now() + data.expiresInHours * 60 * 60 * 1000).toISOString()
      : null;
    let code = inviteCode();
    while (db.prepare('SELECT 1 FROM server_invites WHERE code = ?').get(code)) code = inviteCode();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO server_invites (id, code, server_id, channel_id, created_by, max_uses, uses, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, code, server.id, data.channelId ?? null, req.user.id, data.maxUses ?? 0, expiresAt, nowIso());
    audit(req.user.id, 'server.invite_created', {
      targetType: 'server',
      targetId: server.id,
      metadata: { inviteId: id, expiresAt },
      ip: clientIp(req),
    });
    res.status(201).json({
      invite: { id, code, expiresAt, maxUses: data.maxUses ?? 0, uses: 0, channelId: data.channelId ?? null },
    });
  }),
);

router.get(
  '/:id/invites',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_INVITES);
    const rows = db
      .prepare(
        `SELECT i.*, u.username AS creator_username, u.display_name AS creator_name
           FROM server_invites i LEFT JOIN users u ON u.id = i.created_by
          WHERE i.server_id = ? AND i.revoked_at IS NULL
          ORDER BY i.created_at DESC`,
      )
      .all(server.id);
    res.json({
      invites: rows.map((row) => ({
        id: row.id,
        code: row.code,
        channelId: row.channel_id,
        uses: row.uses,
        maxUses: row.max_uses,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        creator: row.created_by
          ? { id: row.created_by, username: row.creator_username, displayName: row.creator_name }
          : null,
      })),
    });
  }),
);

router.delete(
  '/:id/invites/:inviteId',
  route(async (req, res) => {
    const { server } = requireServerMember(req.params.id, req.user.id);
    requirePermission(server.id, req.user.id, P.MANAGE_INVITES);
    db.prepare('UPDATE server_invites SET revoked_at = ? WHERE id = ? AND server_id = ?').run(
      nowIso(),
      req.params.inviteId,
      server.id,
    );
    res.json({ ok: true });
  }),
);
