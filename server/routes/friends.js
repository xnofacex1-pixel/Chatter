import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, nowIso } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { publicUser } from '../lib/presenters.js';
import { rateLimit } from '../lib/rate-limit.js';
import { publish } from '../lib/realtime.js';
import { audit } from '../lib/sessions.js';
import {
  areFriends,
  blockedEitherWay,
  friendPair,
  friendsOf,
  hasBlocked,
  settingsRow,
  userRow,
} from '../lib/social.js';
import { requireUser } from './me.js';

export const router = Router();

router.use(requireUser);
// Rate limits are per account, not per IP: several members can share a network.
router.use((req, _res, next) => {
  req.rateLimitKey = req.user.id;
  next();
});

function requestView(row, viewerId) {
  const otherId = row.from_user_id === viewerId ? row.to_user_id : row.from_user_id;
  const other = userRow(otherId);
  return {
    id: row.id,
    message: row.message || null,
    createdAt: row.created_at,
    direction: row.from_user_id === viewerId ? 'outgoing' : 'incoming',
    user: other ? publicUser(other) : null,
  };
}

function blockedList(userId) {
  return db
    .prepare('SELECT blocked_id, created_at FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((row) => ({ user: publicUser(userRow(row.blocked_id)), createdAt: row.created_at }))
    .filter((entry) => entry.user);
}

router.get(
  '/',
  route(async (req, res) => {
    const me = req.user.id;
    const friends = friendsOf(me).sort((a, b) => {
      const rank = (user) => (user.presence === 'online' ? 0 : user.presence === 'offline' ? 2 : 1);
      return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
    });
    const incoming = db
      .prepare(`SELECT * FROM friend_requests WHERE to_user_id = ? AND status = 'pending' ORDER BY created_at DESC`)
      .all(me)
      .map((row) => requestView(row, me));
    const outgoing = db
      .prepare(`SELECT * FROM friend_requests WHERE from_user_id = ? AND status = 'pending' ORDER BY created_at DESC`)
      .all(me)
      .map((row) => requestView(row, me));
    res.json({ friends, incoming, outgoing, blocked: blockedList(me) });
  }),
);

const requestSchema = z.object({
  userId: z.string().uuid().optional(),
  username: z.string().trim().min(1).max(64).optional(),
  message: z.string().trim().max(200).optional(),
});

router.post(
  '/requests',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 40, keyPrefix: 'friend-request' }),
  route(async (req, res) => {
    const parsed = requestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Choose someone to add as a friend.');
    const { userId, username, message } = parsed.data;
    if (!userId && !username) return fail(400, 'invalid_input', 'Choose someone to add as a friend.');

    const target = userId
      ? userRow(userId)
      : db.prepare('SELECT * FROM users WHERE username_lower = ?').get(username.replace(/^@/, '').toLowerCase());
    if (!target || target.is_banned) return fail(404, 'user_not_found', 'We could not find that member.');
    if (target.id === req.user.id) return fail(400, 'self_request', 'You cannot add yourself.');

    if (blockedEitherWay(req.user.id, target.id)) {
      return fail(403, 'blocked', 'You cannot send a friend request to this member.');
    }
    if (areFriends(req.user.id, target.id)) {
      return fail(409, 'already_friends', `You and ${target.display_name} are already friends.`);
    }

    const reverse = db
      .prepare(
        `SELECT * FROM friend_requests
          WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
      )
      .get(target.id, req.user.id);

    if (reverse) {
      // They already asked us: accept instead of creating a mirrored request.
      const now = nowIso();
      const [a, b] = friendPair(req.user.id, target.id);
      db.transaction(() => {
        db.prepare('UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?').run('accepted', now, reverse.id);
        db.prepare('INSERT OR IGNORE INTO friendships (user_a_id, user_b_id, created_at) VALUES (?, ?, ?)').run(a, b, now);
      })();
      publish([target.id, req.user.id], 'friend:update', { reason: 'accepted' });
      return res.status(201).json({
        autoAccepted: true,
        friend: publicUser(userRow(target.id)),
        request: requestView({ ...reverse, status: 'accepted' }, req.user.id),
      });
    }

    const existing = db
      .prepare(
        `SELECT * FROM friend_requests
          WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`,
      )
      .get(req.user.id, target.id);
    if (existing) return fail(409, 'request_pending', 'You already sent that request. It is waiting for a reply.');

    const privacy = settingsRow(target.id)?.friend_request_privacy || 'everyone';
    if (privacy === 'none') return fail(403, 'privacy', 'This member is not accepting friend requests.');
    if (privacy === 'friends' && !areFriends(req.user.id, target.id)) {
      return fail(403, 'privacy', 'This member only accepts requests from friends of friends.');
    }

    const id = randomUUID();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO friend_requests (id, from_user_id, to_user_id, message, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(id, req.user.id, target.id, message || null, createdAt);
    audit(req.user.id, 'friend.request_sent', { targetType: 'user', targetId: target.id, ip: clientIp(req) });
    const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(id);
    publish(target.id, 'friend:update', { reason: 'incoming' });
    publish(req.user.id, 'friend:update', { reason: 'sent' });
    res.status(201).json({ request: requestView(row, req.user.id) });
  }),
);

router.post(
  '/requests/:id/accept',
  rateLimit({ windowMs: 60 * 1000, max: 40, keyPrefix: 'friend-accept' }),
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
    if (!row || row.to_user_id !== req.user.id || row.status !== 'pending') {
      return fail(404, 'request_not_found', 'That friend request is no longer available.');
    }
    const now = nowIso();
    const [a, b] = friendPair(row.from_user_id, row.to_user_id);
    db.transaction(() => {
      db.prepare('UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?').run('accepted', now, row.id);
      db.prepare('INSERT OR IGNORE INTO friendships (user_a_id, user_b_id, created_at) VALUES (?, ?, ?)').run(a, b, now);
    })();
    audit(req.user.id, 'friend.request_accepted', { targetType: 'user', targetId: row.from_user_id, ip: clientIp(req) });
    publish([row.from_user_id, req.user.id], 'friend:update', { reason: 'accepted' });
    res.json({ ok: true, friend: publicUser(userRow(row.from_user_id)) });
  }),
);

router.post(
  '/requests/:id/decline',
  rateLimit({ windowMs: 60 * 1000, max: 40, keyPrefix: 'friend-decline' }),
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
    if (!row || row.to_user_id !== req.user.id || row.status !== 'pending') {
      return fail(404, 'request_not_found', 'That friend request is no longer available.');
    }
    db.prepare('UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?').run('declined', nowIso(), row.id);
    publish([row.from_user_id, req.user.id], 'friend:update', { reason: 'declined' });
    res.json({ ok: true });
  }),
);

router.delete(
  '/requests/:id',
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
    if (!row || row.from_user_id !== req.user.id || row.status !== 'pending') {
      return fail(404, 'request_not_found', 'That friend request is no longer available.');
    }
    db.prepare('UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?').run('cancelled', nowIso(), row.id);
    publish([row.to_user_id, req.user.id], 'friend:update', { reason: 'cancelled' });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:userId',
  route(async (req, res) => {
    const [a, b] = friendPair(req.user.id, req.params.userId);
    const removed = db.prepare('DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?').run(a, b).changes;
    if (!removed) return fail(404, 'not_friends', 'You are not friends with that member.');
    publish([req.user.id, req.params.userId], 'friend:update', { reason: 'removed' });
    res.json({ ok: true });
  }),
);

router.post(
  '/block/:userId',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, keyPrefix: 'block' }),
  route(async (req, res) => {
    const targetId = req.params.userId;
    if (targetId === req.user.id) return fail(400, 'self_block', 'You cannot block yourself.');
    const target = userRow(targetId);
    if (!target) return fail(404, 'user_not_found', 'We could not find that member.');

    const now = nowIso();
    const [a, b] = friendPair(req.user.id, targetId);
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
        req.user.id,
        targetId,
        now,
      );
      db.prepare('DELETE FROM friendships WHERE user_a_id = ? AND user_b_id = ?').run(a, b);
      db.prepare(
        `UPDATE friend_requests SET status = 'cancelled', responded_at = ?
          WHERE status = 'pending' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      ).run(now, req.user.id, targetId, targetId, req.user.id);
    })();
    audit(req.user.id, 'user.blocked', { targetType: 'user', targetId, ip: clientIp(req) });
    publish([req.user.id, targetId], 'friend:update', { reason: 'blocked' });
    res.json({ ok: true, blocked: hasBlocked(req.user.id, targetId) });
  }),
);

router.delete(
  '/block/:userId',
  route(async (req, res) => {
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, req.params.userId);
    publish([req.user.id, req.params.userId], 'friend:update', { reason: 'unblocked' });
    res.json({ ok: true });
  }),
);
