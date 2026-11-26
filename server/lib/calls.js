import { randomUUID } from 'node:crypto';
import { db, nowIso } from '../db.js';
import { fail } from './http.js';
import { memberIds, publish } from './realtime.js';
import { publicUser } from './presenters.js';

/**
 * Call state machine shared by direct calls and community voice channels.
 *
 * The server never touches media: it owns membership, permissions and the
 * signalling relay, while browsers exchange SDP/ICE through short-lived
 * `call:signal` events on the existing SSE stream. A call is only reported as
 * `active` once a participant has actually joined it.
 */
export const CALL_KINDS = ['voice', 'video'];
const LIVE = ['ringing', 'active'];

export const callRow = (id) => db.prepare('SELECT * FROM calls WHERE id = ?').get(id) ?? null;

export function participantRows(callId) {
  return db
    .prepare('SELECT * FROM call_participants WHERE call_id = ? ORDER BY invited_at ASC')
    .all(callId);
}

export const joinedUserIds = (callId) =>
  db
    .prepare("SELECT user_id FROM call_participants WHERE call_id = ? AND state = 'joined'")
    .all(callId)
    .map((row) => row.user_id);

function userRow(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function serializeParticipant(row) {
  const user = userRow(row.user_id);
  return {
    userId: row.user_id,
    state: row.state,
    micMuted: Boolean(row.mic_muted),
    deafened: Boolean(row.deafened),
    videoOn: Boolean(row.video_on),
    screenOn: Boolean(row.screen_on),
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    user: user ? publicUser(user) : null,
  };
}

export function serializeCall(call, viewerId = null) {
  if (!call) return null;
  const participants = participantRows(call.id).map(serializeParticipant);
  const conversation = call.conversation_id
    ? db.prepare('SELECT * FROM conversations WHERE id = ?').get(call.conversation_id)
    : null;
  const channel = call.channel_id
    ? db.prepare('SELECT * FROM server_channels WHERE id = ?').get(call.channel_id)
    : null;
  return {
    id: call.id,
    kind: call.kind,
    status: call.status,
    conversationId: call.conversation_id,
    channelId: call.channel_id,
    serverId: call.server_id,
    channelName: channel?.name ?? null,
    conversationName: conversation?.name ?? null,
    startedBy: call.started_by,
    createdAt: call.created_at,
    endedAt: call.ended_at,
    participants,
    joinedCount: participants.filter((entry) => entry.state === 'joined').length,
    me: viewerId ? (participants.find((entry) => entry.userId === viewerId) ?? null) : null,
  };
}

/** Everyone who should learn about a call: conversation members or community. */
export function callAudience(call) {
  if (call.conversation_id) {
    const conversation = db
      .prepare('SELECT kind, server_id FROM conversations WHERE id = ?')
      .get(call.conversation_id);
    if (conversation?.kind === 'channel' && conversation.server_id) {
      return serverMemberIds(conversation.server_id);
    }
    return memberIds(call.conversation_id);
  }
  if (call.server_id) return serverMemberIds(call.server_id);
  return joinedUserIds(call.id);
}

export const serverMemberIds = (serverId) =>
  db
    .prepare('SELECT user_id FROM server_members WHERE server_id = ?')
    .all(serverId)
    .map((row) => row.user_id);

export function broadcastCall(call, event = 'call:updated', extra = {}) {
  const payload = { call: serializeCall(call), ...extra };
  publish(callAudience(call), event, payload);
}

export function findLiveCall({ conversationId = null, channelId = null }) {
  if (conversationId) {
    return (
      db
        .prepare(
          `SELECT * FROM calls
            WHERE conversation_id = ? AND status IN ('ringing','active')
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(conversationId) ?? null
    );
  }
  if (channelId) {
    return (
      db
        .prepare(
          `SELECT * FROM calls
            WHERE channel_id = ? AND status IN ('ringing','active')
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(channelId) ?? null
    );
  }
  return null;
}

export function addParticipant(callId, userId, state = 'invited') {
  const existing = db
    .prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
    .get(callId, userId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO call_participants (call_id, user_id, state, invited_at)
     VALUES (?, ?, ?, ?)`,
  ).run(callId, userId, state, nowIso());
  return db
    .prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
    .get(callId, userId);
}

export function setParticipantState(callId, userId, state) {
  const joinedAt = state === 'joined' ? nowIso() : null;
  const leftAt = state === 'left' || state === 'declined' ? nowIso() : null;
  db.prepare(
    `UPDATE call_participants
        SET state = ?,
            joined_at = COALESCE(?, joined_at),
            left_at = COALESCE(?, left_at)
      WHERE call_id = ? AND user_id = ?`,
  ).run(state, joinedAt, leftAt, callId, userId);
}

export function requireParticipant(callId, userId) {
  const row = db
    .prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
    .get(callId, userId);
  if (!row) fail(404, 'call_not_found', 'That call does not exist.');
  return row;
}

export function endCall(call, { by = null, reason = 'ended' } = {}) {
  if (call.status === 'ended') return call;
  db.prepare("UPDATE calls SET status = 'ended', ended_at = ? WHERE id = ?").run(nowIso(), call.id);
  db.prepare(
    `UPDATE call_participants SET state = 'left', left_at = COALESCE(left_at, ?)
      WHERE call_id = ? AND state = 'joined'`,
  ).run(nowIso(), call.id);
  const ended = callRow(call.id);
  publish(callAudience(ended), 'call:ended', {
    callId: ended.id,
    conversationId: ended.conversation_id,
    channelId: ended.channel_id,
    serverId: ended.server_id,
    reason,
    by,
  });
  return ended;
}

/** A call with nobody connected is over: this is what turns ring-timeouts into missed calls. */
export function endIfEmpty(call, reason = 'empty') {
  if (!LIVE.includes(call.status)) return call;
  if (joinedUserIds(call.id).length > 0) return call;
  return endCall(call, { reason });
}

export function createCall({ kind, conversationId = null, channelId = null, serverId = null, userId }) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO calls (id, kind, conversation_id, channel_id, server_id, started_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, kind, conversationId, channelId, serverId, userId, 'ringing', nowIso());
  addParticipant(id, userId, 'joined');
  db.prepare(
    "UPDATE call_participants SET joined_at = ? WHERE call_id = ? AND user_id = ?",
  ).run(nowIso(), id, userId);
  return callRow(id);
}

/**
 * Ring timeout sweep. A direct call nobody answers is closed so the caller and
 * callee both get a definitive "missed call" instead of a stuck ring forever.
 */
const RING_TIMEOUT_MS = 60_000;
setInterval(() => {
  const stale = db
    .prepare("SELECT * FROM calls WHERE status IN ('ringing','active')")
    .all();
  for (const call of stale) {
    const joined = joinedUserIds(call.id).length;
    const age = Date.now() - new Date(call.created_at).getTime();
    if (joined === 0 && age > RING_TIMEOUT_MS) endCall(call, { reason: 'missed' });
  }
}, 20_000).unref?.();

export const LIVE_STATUSES = LIVE;
