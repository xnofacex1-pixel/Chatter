import { db } from '../db.js';
import { fail } from './http.js';

/**
 * Server (community) permission engine.
 *
 * Permissions are bit flags stored as an integer on each role; the effective
 * permission set is always computed on the server from the database. A browser
 * can never send a permission set of its own.
 */
export const P = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  MANAGE_ROLES: 1 << 4,
  MANAGE_SERVER: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  CREATE_INVITES: 1 << 8,
  MANAGE_INVITES: 1 << 9,
  MENTION_EVERYONE: 1 << 10,
  CONNECT: 1 << 11,
  SPEAK: 1 << 12,
  MUTE_MEMBERS: 1 << 13,
  DEAFEN_MEMBERS: 1 << 14,
  MOVE_MEMBERS: 1 << 15,
  PIN_MESSAGES: 1 << 16,
  VIEW_AUDIT_LOG: 1 << 17,
  MANAGE_NICKNAMES: 1 << 18,
  TIMEOUT_MEMBERS: 1 << 19,
  ADMINISTRATOR: 1 << 20,
};

export const ALL_PERMISSIONS = (1 << 21) - 1;

export const PERMISSION_LABELS = {
  [P.VIEW_CHANNEL]: 'View channels',
  [P.SEND_MESSAGES]: 'Send messages',
  [P.MANAGE_MESSAGES]: 'Manage and delete messages',
  [P.MANAGE_CHANNELS]: 'Manage channels',
  [P.MANAGE_ROLES]: 'Manage roles',
  [P.MANAGE_SERVER]: 'Manage community',
  [P.KICK_MEMBERS]: 'Kick members',
  [P.BAN_MEMBERS]: 'Ban members',
  [P.CREATE_INVITES]: 'Create invites',
  [P.MANAGE_INVITES]: 'Manage invites',
  [P.MENTION_EVERYONE]: 'Mention everyone',
  [P.CONNECT]: 'Connect to voice',
  [P.SPEAK]: 'Speak in voice',
  [P.MUTE_MEMBERS]: 'Mute members',
  [P.DEAFEN_MEMBERS]: 'Deafen members',
  [P.MOVE_MEMBERS]: 'Move members between channels',
  [P.PIN_MESSAGES]: 'Pin messages',
  [P.VIEW_AUDIT_LOG]: 'View moderation log',
  [P.MANAGE_NICKNAMES]: 'Manage nicknames',
  [P.TIMEOUT_MEMBERS]: 'Timeout members',
  [P.ADMINISTRATOR]: 'Administrator (all permissions)',
};

export const PERMISSION_LIST = Object.entries(PERMISSION_LABELS).map(([bit, label]) => ({
  bit: Number(bit),
  label,
  key: Object.keys(P).find((name) => P[name] === Number(bit)),
}));

export const DEFAULT_MEMBER_PERMISSIONS =
  P.VIEW_CHANNEL | P.SEND_MESSAGES | P.CREATE_INVITES | P.CONNECT | P.SPEAK;

export const MODERATOR_PERMISSIONS =
  DEFAULT_MEMBER_PERMISSIONS |
  P.MANAGE_MESSAGES |
  P.KICK_MEMBERS |
  P.TIMEOUT_MEMBERS |
  P.MUTE_MEMBERS |
  P.DEAFEN_MEMBERS |
  P.PIN_MESSAGES |
  P.MANAGE_NICKNAMES |
  P.MANAGE_INVITES |
  P.VIEW_AUDIT_LOG;

export const has = (permissions, bit) => (permissions & bit) === bit;

export const serverRow = (serverId) =>
  serverId ? db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) : null;

export function requireServer(serverId) {
  const row = serverRow(serverId);
  if (!row) fail(404, 'server_not_found', 'That community does not exist.');
  return row;
}

export const memberRow = (serverId, userId) =>
  db.prepare('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);

export function requireServerMember(serverId, userId) {
  const server = requireServer(serverId);
  if (server.is_suspended) fail(403, 'server_suspended', 'This community is suspended.');
  const member = memberRow(serverId, userId);
  if (!member) fail(404, 'server_not_found', 'That community does not exist.');
  return { server, member };
}

export const isPlatformOwner = (userId) =>
  Boolean(userId && db.prepare('SELECT is_owner FROM users WHERE id = ?').get(userId)?.is_owner);

export const isServerOwner = (server, userId) => Boolean(server && server.owner_id === userId);

export const rolesOfServer = (serverId) =>
  db
    .prepare('SELECT * FROM server_roles WHERE server_id = ? ORDER BY position DESC, created_at ASC')
    .all(serverId);

export const defaultRole = (serverId) =>
  db.prepare('SELECT * FROM server_roles WHERE server_id = ? AND is_default = 1').get(serverId);

export function memberRoles(serverId, userId) {
  return db
    .prepare(
      `SELECT r.* FROM server_member_roles mr
         JOIN server_roles r ON r.id = mr.role_id
        WHERE mr.server_id = ? AND mr.user_id = ?
        ORDER BY r.position DESC`,
    )
    .all(serverId, userId);
}

/** Union of every assigned role plus @everyone. */
export function basePermissions(serverId, userId) {
  const server = serverRow(serverId);
  if (!server) return 0;
  if (isServerOwner(server, userId) || isPlatformOwner(userId)) return ALL_PERMISSIONS;
  if (!memberRow(serverId, userId)) return 0;
  let permissions = defaultRole(serverId)?.permissions ?? 0;
  for (const role of memberRoles(serverId, userId)) permissions |= role.permissions;
  if (has(permissions, P.ADMINISTRATOR)) return ALL_PERMISSIONS;
  return permissions;
}

/**
 * Channel permissions = base permissions with @everyone, role and member
 * overwrites applied in that order (deny wins inside each overwrite).
 * Administrators bypass channel overwrites, as in the rest of the platform.
 */
export function channelPermissions(serverId, userId, channelId) {
  let permissions = basePermissions(serverId, userId);
  if (permissions === ALL_PERMISSIONS) return permissions;
  const everyone = defaultRole(serverId);
  const overwrites = db
    .prepare('SELECT * FROM server_channel_overwrites WHERE channel_id = ?')
    .all(channelId);

  const apply = (targetType, targetId, current) => {
    const row = overwrites.find((entry) => entry.target_type === targetType && entry.target_id === targetId);
    if (!row) return current;
    return (current & ~row.deny) | row.allow;
  };

  permissions = apply('role', everyone?.id, permissions);
  for (const role of memberRoles(serverId, userId)) permissions = apply('role', role.id, permissions);
  permissions = apply('member', userId, permissions);
  return permissions;
}

export function requirePermission(serverId, userId, permission, channelId = null) {
  const permissions = channelId
    ? channelPermissions(serverId, userId, channelId)
    : basePermissions(serverId, userId);
  if (!has(permissions, permission)) {
    fail(403, 'missing_permission', 'You do not have permission to do that.');
  }
  return permissions;
}

/** Highest role position; the owner and platform owner always outrank roles. */
export function topPosition(serverId, userId) {
  const server = serverRow(serverId);
  if (isServerOwner(server, userId) || isPlatformOwner(userId)) return Number.MAX_SAFE_INTEGER;
  const roles = memberRoles(serverId, userId);
  return roles.reduce((max, role) => Math.max(max, role.position), 0);
}

export function assertCanActOnMember(server, actorId, targetId) {
  if (targetId === actorId) fail(400, 'invalid_target', 'You cannot perform that action on yourself.');
  if (server.owner_id === targetId) fail(403, 'owner_protected', 'The community owner cannot be moderated.');
  if (isServerOwner(server, actorId) || isPlatformOwner(actorId)) return;
  if (topPosition(server.id, targetId) >= topPosition(server.id, actorId)) {
    fail(403, 'role_hierarchy', 'That member has an equal or higher role than you.');
  }
}

export function serializeRole(role) {
  if (!role) return null;
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    permissions: role.permissions,
    position: role.position,
    isDefault: Boolean(role.is_default),
    isSystem: Boolean(role.is_system),
  };
}

export function serializeChannel(row, permissions) {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    type: row.type,
    topic: row.topic,
    categoryId: row.category_id,
    position: row.position,
    isPrivate: Boolean(row.is_private),
    readOnly: Boolean(row.read_only),
    slowmodeSeconds: row.slowmode_seconds,
    userLimit: row.user_limit,
    conversationId: row.conversation_id,
    canView: has(permissions, P.VIEW_CHANNEL),
    canSend: has(permissions, P.SEND_MESSAGES),
    canConnect: has(permissions, P.CONNECT),
    canManage: has(permissions, P.MANAGE_CHANNELS),
    unreadCount: 0,
  };
}

export const serverMemberIds = (serverId) =>
  db
    .prepare('SELECT user_id FROM server_members WHERE server_id = ?')
    .all(serverId)
    .map((row) => row.user_id);

/** Everyone who may see a channel: used for message fan-out and search. */
export function channelAudience(serverId, channelId) {
  return serverMemberIds(serverId).filter((userId) =>
    has(channelPermissions(serverId, userId, channelId), P.VIEW_CHANNEL),
  );
}

export const notificationPref = (serverId, userId) =>
  db
    .prepare('SELECT * FROM server_notification_prefs WHERE server_id = ? AND user_id = ?')
    .get(serverId, userId) ?? { server_id: serverId, user_id: userId, level: 'all', muted_until: null };

export function serverSettingsRow(serverId) {
  const row = db.prepare('SELECT * FROM server_settings WHERE server_id = ?').get(serverId);
  return {
    welcomeMessage: row?.welcome_message ?? null,
    defaultNotificationLevel: row?.default_notification_level ?? 'all',
    verificationLevel: row?.verification_level ?? 'none',
  };
}

function onlineCount(serverId) {
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT COUNT(*) AS total FROM server_members sm
         JOIN users u ON u.id = sm.user_id
        WHERE sm.server_id = ? AND u.last_seen_at > ? AND u.status <> 'invisible'`,
    )
    .get(serverId, threshold).total;
}

export function serverSummary(server, viewerId) {
  const memberCount = db
    .prepare('SELECT COUNT(*) AS total FROM server_members WHERE server_id = ?')
    .get(server.id).total;
  const viewerMember = memberRow(server.id, viewerId);
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    iconUrl: server.icon_media_id ? `/api/media/${server.icon_media_id}` : null,
    bannerUrl: server.banner_media_id ? `/api/media/${server.banner_media_id}` : null,
    isPublic: Boolean(server.is_public),
    isSuspended: Boolean(server.is_suspended),
    ownerId: server.owner_id,
    createdAt: server.created_at,
    memberCount,
    onlineCount: onlineCount(server.id),
    permissions: basePermissions(server.id, viewerId),
    isOwner: isServerOwner(server, viewerId),
    isPlatformOwner: isPlatformOwner(viewerId),
    joined: Boolean(viewerMember),
    myRoles: memberRoles(server.id, viewerId).map(serializeRole),
    notificationLevel: notificationPref(server.id, viewerId).level,
  };
}

export function memberPayload(server, member, user) {
  return {
    user,
    nickname: member.nickname,
    joinedAt: member.joined_at,
    timeoutUntil: member.timeout_until,
    roles: memberRoles(server.id, member.user_id).map(serializeRole),
    isOwner: server.owner_id === member.user_id,
  };
}
