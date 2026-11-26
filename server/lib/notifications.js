import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db.js';
import { publish } from './realtime.js';

/**
 * Which user_settings column gates each notification type. Anything not listed
 * here is considered essential account activity and is always stored.
 */
const PREFERENCE_COLUMNS = {
  message: 'notif_messages',
  mention: 'notif_mentions',
  reply: 'notif_mentions',
  reaction: 'notif_messages',
  friend_request: 'notif_desktop',
  friend_accepted: 'notif_desktop',
  server_invite: 'notif_desktop',
  call_incoming: 'notif_calls',
  call_missed: 'notif_calls',
  moderation: 'notif_desktop',
  announcement: 'notif_desktop',
};

export function notificationEnabled(userId, type) {
  const column = PREFERENCE_COLUMNS[type];
  if (!column) return true;
  const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!row) return true;
  return Boolean(row[column]);
}

function actorFor(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const profile = db.prepare('SELECT avatar_media_id FROM user_profiles WHERE user_id = ?').get(userId);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: profile?.avatar_media_id ? `/api/media/${profile.avatar_media_id}` : null,
  };
}

export function notificationView(row, actor = null) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    link: row.link ?? null,
    actor: actor ?? null,
    serverId: row.server_id ?? null,
    conversationId: row.conversation_id ?? null,
    messageId: row.message_id ?? null,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Store a notification and push it to any live session for that account.
 * Preferences are enforced here so callers never have to remember them.
 */
export function notify(
  userId,
  { type, title, body = null, link = null, actorId = null, serverId = null, conversationId = null, messageId = null, force = false },
) {
  if (!userId || !type || !title) return null;
  if (actorId && actorId === userId && !force) return null;
  if (!force && !notificationEnabled(userId, type)) return null;

  const row = {
    id: randomUUID(),
    user_id: userId,
    type,
    title,
    body,
    link,
    actor_id: actorId,
    server_id: serverId,
    conversation_id: conversationId,
    message_id: messageId,
    read_at: null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link, actor_id, server_id, conversation_id, message_id, read_at, created_at)
     VALUES (@id, @user_id, @type, @title, @body, @link, @actor_id, @server_id, @conversation_id, @message_id, @read_at, @created_at)`,
  ).run(row);

  const view = notificationView(row, actorId ? actorFor(actorId) : null);
  publish(userId, 'notification', view);
  return view;
}

/** Notify several accounts at once, skipping the acting user. */
export function notifyMany(userIds, payload) {
  const created = [];
  for (const userId of new Set(userIds)) {
    const view = notify(userId, payload);
    if (view) created.push(view);
  }
  return created;
}

export function unreadCount(userId) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId);
  return row?.total ?? 0;
}

/**
 * Fan out a direct or group message to every other member of the conversation,
 * upgrading to a mention when the body names them. Muted conversations and the
 * member's own notification preferences are respected by notify().
 */
export function notifyConversationMessage({ conversationId, authorId, messageId, body }) {
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  if (!conversation) return [];
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(authorId);
  const authorName = author?.display_name || author?.username || 'Someone';
  const members = db
    .prepare(
      `SELECT u.id, u.username, m.muted
         FROM conversation_members m JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = ? AND m.user_id != ?`,
    )
    .all(conversationId, authorId);

  const isDirect = conversation.kind === 'direct';
  const created = [];
  for (const member of members) {
    if (member.muted) continue;
    const mentioned = Boolean(body) && new RegExp(`@${member.username}\\b`, 'i').test(body);
    const view = notify(member.id, {
      type: mentioned ? 'mention' : 'message',
      title: isDirect
        ? `${authorName} sent you a message`
        : `${authorName} in ${conversation.title || 'Group chat'}`,
      body: body ? body.slice(0, 160) : 'Sent an attachment',
      link: `/messages/${conversationId}`,
      actorId: authorId,
      conversationId,
      messageId,
    });
    if (view) created.push(view);
  }
  return created;
}

export function actorsFor(rows) {
  const ids = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))];
  const actors = new Map();
  if (!ids.length) return actors;
  const placeholders = ids.map(() => '?').join(',');
  const found = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, p.avatar_media_id
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id IN (${placeholders})`,
    )
    .all(...ids);
  for (const actor of found) {
    actors.set(actor.id, {
      id: actor.id,
      username: actor.username,
      displayName: actor.display_name,
      avatarUrl: actor.avatar_media_id ? `/api/media/${actor.avatar_media_id}` : null,
    });
  }
  return actors;
}
