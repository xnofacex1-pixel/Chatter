import { db } from '../db.js';

/**
 * Server-Sent Events hub. One process, one node: every open tab keeps a
 * long-lived response in this map, keyed by the authenticated user id.
 *
 * Chat state itself lives in SQLite and is fetched over REST; the stream only
 * carries "something changed" events, so a dropped connection can never lose
 * a message.
 */
const clients = new Map();

const KEEPALIVE_MS = 25_000;

setInterval(() => {
  for (const set of clients.values()) {
    for (const res of set) {
      try {
        res.write(': ping\n\n');
      } catch {
        /* socket already closing */
      }
    }
  }
}, KEEPALIVE_MS).unref?.();

export function subscribe(userId, res) {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(res);
  return () => {
    const current = clients.get(userId);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) clients.delete(userId);
  };
}

export const isConnected = (userId) => clients.has(userId);
export const connectionCount = (userId) => clients.get(userId)?.size ?? 0;
export const connectedUserIds = () => [...clients.keys()];

function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client vanished mid-write; cleanup happens on the close event */
  }
}

/** Publish to one user id or a list of them, de-duplicated. */
export function publish(userIds, event, data) {
  const targets = Array.isArray(userIds) ? userIds : [userIds];
  for (const id of new Set(targets.filter(Boolean))) {
    const set = clients.get(id);
    if (!set) continue;
    for (const res of set) send(res, event, data);
  }
}

export function memberIds(conversationId) {
  return db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId)
    .map((row) => row.user_id);
}

/** Publish to every member of a conversation. */
export function publishToConversation(conversationId, event, data) {
  publish(memberIds(conversationId), event, data);
}

/** Everyone who should learn about a user's presence: friends + DM partners. */
export function presenceAudience(userId) {
  const ids = new Set();
  const friends = db
    .prepare('SELECT user_a_id, user_b_id FROM friendships WHERE user_a_id = ? OR user_b_id = ?')
    .all(userId, userId);
  for (const row of friends) ids.add(row.user_a_id === userId ? row.user_b_id : row.user_a_id);
  const partners = db
    .prepare(
      `SELECT m2.user_id
         FROM conversation_members m1
         JOIN conversations c ON c.id = m1.conversation_id AND c.kind = 'dm'
         JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id AND m2.user_id <> m1.user_id
        WHERE m1.user_id = ?`,
    )
    .all(userId);
  for (const row of partners) ids.add(row.user_id);
  ids.delete(userId);
  return [...ids];
}
