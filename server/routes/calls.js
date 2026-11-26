import { Router } from 'express';
import { db } from '../db.js';
import { fail, route } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';
import { requireUser } from './me.js';
import { publish, memberIds } from '../lib/realtime.js';
import { notify } from '../lib/notifications.js';
import { canDirectMessage, requireConversation, requireMembership } from '../lib/social.js';
import { channelPermissions, has, P, requireServerMember } from '../lib/server-perms.js';
import {
  addParticipant,
  broadcastCall,
  callRow,
  CALL_KINDS,
  createCall,
  endCall,
  endIfEmpty,
  findLiveCall,
  joinedUserIds,
  participantRows,
  requireParticipant,
  serializeCall,
  setParticipantState,
} from '../lib/calls.js';

export const router = Router();

router.use(requireUser);

const signalLimit = rateLimit({ windowMs: 10_000, max: 400, keyPrefix: 'call-signal' });
const startLimit = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'call-start' });

/** Resolve and authorise the media room a call belongs to. */
function resolveTarget(req, body) {
  const me = req.user.id;
  const kind = CALL_KINDS.includes(body?.kind) ? body.kind : 'voice';
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
  const channelId = typeof body?.channelId === 'string' ? body.channelId : null;

  if (conversationId) {
    const conversation = requireConversation(conversationId);
    if (conversation.kind === 'channel' && conversation.channel_id) {
      return channelTarget(req, conversation.channel_id, kind);
    }
    requireMembership(conversationId, me);
    const others = memberIds(conversationId).filter((id) => id !== me);
    if (others.length === 0) fail(400, 'call_no_recipient', 'There is nobody to call here.');
    for (const other of others) {
      const allowed = canDirectMessage(me, other);
      if (!allowed.ok) fail(403, 'call_not_allowed', allowed.message);
    }
    return { kind, conversationId, channelId: null, serverId: conversation.server_id ?? null };
  }

  if (channelId) return channelTarget(req, channelId, kind);

  fail(400, 'call_target_required', 'Choose a conversation or voice channel to call.');
  return null;
}

function channelTarget(req, channelId, kind) {
  const channel = db.prepare('SELECT * FROM server_channels WHERE id = ?').get(channelId);
  if (!channel) fail(404, 'channel_not_found', 'That channel does not exist.');
  if (channel.type !== 'voice') fail(400, 'channel_not_voice', 'That channel is not a voice channel.');
  const { server } = requireServerMember(channel.server_id, req.user.id);
  const permissions = channelPermissions(server.id, req.user.id, channel.id);
  if (!has(permissions, P.CONNECT)) {
    fail(403, 'missing_permission', 'You do not have permission to join that voice channel.');
  }
  return { kind, conversationId: null, channelId: channel.id, serverId: server.id };
}

/** Start (or rejoin) the live call for a conversation or voice channel. */
router.post(
  '/start',
  startLimit,
  route(async (req, res) => {
    const target = resolveTarget(req, req.body);
    const existing = findLiveCall(target);
    if (existing) {
      addParticipant(existing.id, req.user.id, 'joined');
      setParticipantState(existing.id, req.user.id, 'joined');
      db.prepare("UPDATE calls SET status = 'active' WHERE id = ?").run(existing.id);
      const call = callRow(existing.id);
      broadcastCall(call);
      res.json({ call: serializeCall(call, req.user.id) });
      return;
    }

    const call = createCall({ ...target, userId: req.user.id });
    db.prepare("UPDATE calls SET status = 'active' WHERE id = ?").run(call.id);
    const fresh = callRow(call.id);

    const others = memberIdsOrServer(fresh).filter((id) => id !== req.user.id);
    if (fresh.conversation_id && !fresh.channel_id) {
      for (const other of others) {
        addParticipant(fresh.id, other, 'invited');
        publish(other, 'call:incoming', { call: serializeCall(fresh) });
      }
    }
    broadcastCall(fresh);
    res.status(201).json({ call: serializeCall(fresh, req.user.id) });
  }),
);

function memberIdsOrServer(call) {
  if (call.conversation_id) return memberIds(call.conversation_id);
  return db
    .prepare('SELECT user_id FROM server_members WHERE server_id = ?')
    .all(call.server_id)
    .map((row) => row.user_id);
}

/** Calls this account is part of right now (used to restore state after reload). */
router.get(
  '/active',
  route(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.* FROM calls c
           JOIN call_participants p ON p.call_id = c.id
          WHERE p.user_id = ? AND c.status IN ('ringing','active')
          ORDER BY c.created_at DESC`,
      )
      .all(req.user.id);
    res.json({ calls: rows.map((row) => serializeCall(row, req.user.id)) });
  }),
);

router.get(
  '/:id',
  route(async (req, res) => {
    const call = callRow(req.params.id);
    if (!call) fail(404, 'call_not_found', 'That call does not exist.');
    requireParticipant(call.id, req.user.id);
    res.json({ call: serializeCall(call, req.user.id) });
  }),
);

/** Join an existing call (voice channels, or a ring the callee accepted). */
router.post(
  '/:id/join',
  route(async (req, res) => {
    const call = callRow(req.params.id);
    if (!call) fail(404, 'call_not_found', 'That call does not exist.');
    if (call.status === 'ended') fail(409, 'call_ended', 'That call has already ended.');

    if (call.channel_id) {
      const channel = db.prepare('SELECT * FROM server_channels WHERE id = ?').get(call.channel_id);
      const { server } = requireServerMember(call.server_id, req.user.id);
      const permissions = channelPermissions(server.id, req.user.id, channel.id);
      if (!has(permissions, P.CONNECT)) {
        fail(403, 'missing_permission', 'You do not have permission to join that voice channel.');
      }
    } else if (call.conversation_id) {
      requireMembership(call.conversation_id, req.user.id);
    }

    addParticipant(call.id, req.user.id, 'joined');
    setParticipantState(call.id, req.user.id, 'joined');
    db.prepare("UPDATE calls SET status = 'active' WHERE id = ?").run(call.id);
    const updated = callRow(call.id);
    broadcastCall(updated);
    res.json({ call: serializeCall(updated, req.user.id) });
  }),
);

router.post(
  '/:id/decline',
  route(async (req, res) => {
    const call = callRow(req.params.id);
    if (!call) fail(404, 'call_not_found', 'That call does not exist.');
    requireParticipant(call.id, req.user.id);
    setParticipantState(call.id, req.user.id, 'declined');
    const updated = endIfEmpty(callRow(call.id), 'declined');
    broadcastCall(updated);

    // A declined ring that nobody joined is a missed call for the caller.
    if (updated.ended_at) {
      const decliner = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      const name = decliner?.display_name || decliner?.username || 'Someone';
      for (const participant of participantRows(call.id)) {
        if (participant.user_id === req.user.id) continue;
        notify(participant.user_id, {
          type: 'call_missed',
          title: `Missed ${updated.kind} call from ${name}`,
          body: 'The call ended before it was answered.',
          link: '/messages',
          actorId: req.user.id,
        });
      }
    }
    res.json({ call: serializeCall(updated, req.user.id) });
  }),
);

router.post(
  '/:id/leave',
  route(async (req, res) => {
    const call = callRow(req.params.id);
    if (!call) fail(404, 'call_not_found', 'That call does not exist.');
    requireParticipant(call.id, req.user.id);
    setParticipantState(call.id, req.user.id, 'left');
    const updated = endIfEmpty(callRow(call.id), 'left');
    broadcastCall(updated);
    res.json({ call: serializeCall(updated, req.user.id) });
  }),
);

router.post(
  '/:id/end',
  route(async (req, res) => {
    const call = callRow(req.params.id);
    if (!call) fail(404, 'call_not_found', 'That call does not exist.');
    const participant = requireParticipant(call.id, req.user.id);
    if (call.channel_id && participant.state !== 'joined') {
      const permissions = channelPermissions(call.server_id, req.user.id, call.channel_id);
      if (!has(permissions, P.MANAGE_CHANNELS)) {
        fail(403, 'missing_permission', 'You cannot end this call.');
      }
    }
    const ended = endCall(call, { by: req.user.id, reason: 'ended' });
    res.json({ call: serializeCall(ended, req.user.id) });
  }),
);

/** Mute, deafen, camera and screen-share flags — broadcast to everyone in the call. */
router.patch(
  '/:id/state',
  route(async (req, res) => {
    const call = callRow(req.params.id);
    if (!call) fail(404, 'call_not_found', 'That call does not exist.');
    requireParticipant(call.id, req.user.id);
    const body = req.body ?? {};
    const fields = [
      ['micMuted', 'mic_muted'],
      ['deafened', 'deafened'],
      ['videoOn', 'video_on'],
      ['screenOn', 'screen_on'],
    ];
    for (const [key, column] of fields) {
      if (typeof body[key] === 'boolean') {
        db.prepare(`UPDATE call_participants SET ${column} = ? WHERE call_id = ? AND user_id = ?`).run(
          body[key] ? 1 : 0,
          call.id,
          req.user.id,
        );
      }
    }
    const updated = callRow(call.id);
    broadcastCall(updated);
    res.json({ call: serializeCall(updated, req.user.id) });
  }),
);

/**
 * WebRTC relay. The server validates that both accounts are joined to the same
 * live call, then forwards the payload untouched — SDP and ICE never persist.
 */
router.post(
  '/:id/signal',
  signalLimit,
  route(async (req, res) => {
    const call = callRow(req.params.id);
    if (!call) fail(404, 'call_not_found', 'That call does not exist.');
    if (call.status === 'ended') fail(409, 'call_ended', 'That call has already ended.');
    requireParticipant(call.id, req.user.id);

    const to = typeof req.body?.to === 'string' ? req.body.to : null;
    if (!to) fail(400, 'signal_target_required', 'A signal target is required.');
    if (!joinedUserIds(call.id).includes(to)) {
      fail(403, 'signal_target_invalid', 'That account is not in this call.');
    }
    if (!joinedUserIds(call.id).includes(req.user.id)) {
      fail(403, 'signal_not_joined', 'Join the call before sending signals.');
    }

    const data = req.body?.data;
    if (!data || typeof data !== 'object') fail(400, 'signal_payload_required', 'A signal payload is required.');
    const type = data.type;
    if (!['offer', 'answer', 'ice', 'renegotiate'].includes(type)) {
      fail(400, 'signal_type_invalid', 'Unsupported signal type.');
    }
    if (type !== 'ice' && typeof data.sdp !== 'string') {
      fail(400, 'signal_sdp_required', 'A session description is required.');
    }
    if (type === 'ice' && (!data.candidate || typeof data.candidate !== 'object')) {
      fail(400, 'signal_candidate_required', 'An ICE candidate is required.');
    }

    publish(to, 'call:signal', {
      callId: call.id,
      from: req.user.id,
      data,
    });
    res.json({ ok: true });
  }),
);
