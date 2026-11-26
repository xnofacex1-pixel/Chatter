import { db, nowIso } from '../db.js';
import { fail } from './http.js';
import { publish } from './realtime.js';
import { audit } from './sessions.js';
import { memberRow, serverMemberIds } from './server-perms.js';

/**
 * Shared membership transition used by both invite links and public joins, so
 * bans, suspensions and duplicate membership are enforced in exactly one place.
 */
export function joinServer(server, userId, { inviteId = null, ip = null } = {}) {
  if (server.is_suspended) fail(403, 'server_suspended', 'This community is suspended.');
  const banned = db
    .prepare('SELECT * FROM server_bans WHERE server_id = ? AND user_id = ?')
    .get(server.id, userId);
  if (banned) fail(403, 'server_banned', 'You are banned from this community.');
  if (memberRow(server.id, userId)) return { alreadyMember: true };

  db.prepare('INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    server.id,
    userId,
    nowIso(),
  );
  audit(userId, 'server.joined', {
    targetType: 'server',
    targetId: server.id,
    metadata: inviteId ? { inviteId } : null,
    ip,
  });
  publish(serverMemberIds(server.id), 'server:member_joined', { serverId: server.id, userId });
  return { alreadyMember: false };
}

export function leaveServer(server, userId, { ip = null } = {}) {
  if (server.owner_id === userId) {
    fail(400, 'owner_cannot_leave', 'Transfer ownership or delete the community before leaving it.');
  }
  const member = memberRow(server.id, userId);
  if (!member) fail(404, 'server_not_found', 'You are not a member of that community.');
  db.prepare('DELETE FROM server_member_roles WHERE server_id = ? AND user_id = ?').run(server.id, userId);
  db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(server.id, userId);
  db.prepare('DELETE FROM server_notification_prefs WHERE server_id = ? AND user_id = ?').run(server.id, userId);
  audit(userId, 'server.left', { targetType: 'server', targetId: server.id, ip });
  publish(serverMemberIds(server.id), 'server:member_left', { serverId: server.id, userId });
}
