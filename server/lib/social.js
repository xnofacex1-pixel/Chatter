import { db } from '../db.js';
import { fail } from './http.js';
import { publicUser } from './presenters.js';

export const userRow = (id) => (id ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null);
export const friendPair = (a, b) => (a < b ? [a, b] : [b, a]);

export function areFriends(a, b) {
  if (!a || !b || a === b) return false;
  const [x, y] = friendPair(a, b);
  return Boolean(db.prepare('SELECT 1 FROM friendships WHERE user_a_id = ? AND user_b_id = ?').get(x, y));
}

export const hasBlocked = (blockerId, blockedId) =>
  Boolean(db.prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId));

export const blockedEitherWay = (a, b) => hasBlocked(a, b) || hasBlocked(b, a);

export const blockState = (viewerId, otherId) => ({
  blockedByMe: hasBlocked(viewerId, otherId),
  blockedMe: hasBlocked(otherId, viewerId),
});

export function friendIds(userId) {
  const rows = db
    .prepare('SELECT user_a_id, user_b_id FROM friendships WHERE user_a_id = ? OR user_b_id = ?')
    .all(userId, userId);
  return rows.map((row) => (row.user_a_id === userId ? row.user_b_id : row.user_a_id));
}

export function friendsOf(userId) {
  return friendIds(userId)
    .map((id) => publicUser(userRow(id)))
    .filter(Boolean);
}

export const settingsRow = (userId) =>
  db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);

/**
 * Direct messaging rules, enforced server-side: blocks always win, then the
 * recipient's privacy setting decides.
 */
export function canDirectMessage(fromId, toId) {
  if (fromId === toId) return { ok: false, reason: 'self', message: 'You cannot message yourself.' };
  if (blockedEitherWay(fromId, toId)) {
    return { ok: false, reason: 'blocked', message: 'You cannot message this person.' };
  }
  const privacy = settingsRow(toId)?.dm_privacy || 'everyone';
  if (privacy === 'none') {
    return { ok: false, reason: 'privacy', message: 'This member does not accept direct messages.' };
  }
  if (privacy === 'friends' && !areFriends(fromId, toId)) {
    return { ok: false, reason: 'privacy', message: 'This member only accepts messages from friends.' };
  }
  return { ok: true };
}

export const membership = (conversationId, userId) =>
  db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId);

export function requireConversation(conversationId) {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  if (!row) fail(404, 'conversation_not_found', 'That conversation does not exist.');
  return row;
}

/** Throws 404 (not 403) so outsiders cannot probe which conversations exist. */
export function requireMembership(conversationId, userId) {
  const row = membership(conversationId, userId);
  if (!row) fail(404, 'conversation_not_found', 'That conversation does not exist.');
  return row;
}

export function conversationMemberRows(conversationId) {
  return db
    .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at ASC')
    .all(conversationId);
}

function messagePreview(row) {
  if (!row) return null;
  const author = userRow(row.author_id);
  return {
    id: row.id,
    body: row.deleted_at ? '' : row.body.slice(0, 160),
    createdAt: row.created_at,
    deleted: Boolean(row.deleted_at),
    authorName: author?.display_name || 'Removed member',
    authorId: row.author_id,
  };
}

export function conversationSummary(row, viewerId) {
  const members = conversationMemberRows(row.id);
  const me = members.find((member) => member.user_id === viewerId);
  const partnerRow = row.kind === 'dm' ? members.find((member) => member.user_id !== viewerId) : null;
  const last = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(row.id);
  const unread = db
    .prepare(
      `SELECT COUNT(*) AS total FROM messages
        WHERE conversation_id = ? AND deleted_at IS NULL AND author_id <> ? AND created_at > ?`,
    )
    .get(row.id, viewerId, me?.last_read_at || '1970-01-01T00:00:00.000Z').total;

  return {
    id: row.id,
    kind: row.kind,
    title: row.kind === 'dm' ? null : row.title || 'Group conversation',
    iconUrl: row.icon_media_id ? `/api/media/${row.icon_media_id}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    muted: Boolean(me?.muted),
    archived: Boolean(me?.archived),
    unreadCount: unread,
    memberCount: members.length,
    members: members.map((member) => publicUser(userRow(member.user_id))).filter(Boolean),
    partner: partnerRow ? publicUser(userRow(partnerRow.user_id)) : null,
    lastMessage: messagePreview(last),
  };
}

export function messageFor(row, viewerId) {
  if (!row) return null;
  const author = userRow(row.author_id);
  const attachments = row.deleted_at
    ? []
    : db
        .prepare(
          `SELECT m.id, m.mime, m.byte_size, m.kind
             FROM message_attachments a JOIN media m ON m.id = a.media_id
            WHERE a.message_id = ? ORDER BY a.created_at ASC`,
        )
        .all(row.id)
        .map((media) => ({
          id: media.id,
          url: `/api/attachments/${media.id}`,
          mime: media.mime,
          byteSize: media.byte_size,
          kind: media.kind,
        }));

  const grouped = new Map();
  for (const reaction of db.prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?').all(row.id)) {
    const entry = grouped.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, me: false };
    entry.count += 1;
    if (reaction.user_id === viewerId) entry.me = true;
    grouped.set(reaction.emoji, entry);
  }

  const reply = row.reply_to_id ? db.prepare('SELECT * FROM messages WHERE id = ?').get(row.reply_to_id) : null;
  const replyAuthor = reply ? userRow(reply.author_id) : null;

  return {
    id: row.id,
    conversationId: row.conversation_id,
    body: row.deleted_at ? '' : row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    pinnedAt: row.pinned_at,
    author: author ? publicUser(author) : null,
    attachments,
    reactions: [...grouped.values()],
    replyTo: reply
      ? {
          id: reply.id,
          body: reply.deleted_at ? 'Message deleted' : reply.body.slice(0, 180),
          authorName: replyAuthor?.display_name || 'Removed member',
        }
      : null,
  };
}

export function conversationAudience(row) {
  return conversationMemberRows(row.id).map((member) => member.user_id);
}
