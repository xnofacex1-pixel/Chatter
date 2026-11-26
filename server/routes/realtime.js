import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { route } from '../lib/http.js';
import { effectivePresence, touchPresence } from '../lib/presenters.js';
import { connectedUserIds, presenceAudience, publish, subscribe } from '../lib/realtime.js';
import { requireUser } from './me.js';

export const router = Router();
router.use(requireUser);

const OFFLINE_GRACE_MS = 3 * 60 * 1000;

router.get(
  '/stream',
  route(async (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    req.socket?.setTimeout(0);
    res.write('retry: 3000\n\n');

    const userId = req.user.id;
    touchPresence(userId);
    const audience = presenceAudience(userId);
    const unsubscribe = subscribe(userId, res);

    res.write(`event: ready\ndata: ${JSON.stringify({ userId, serverTime: nowIso() })}\n\n`);
    publish([userId, ...audience], 'presence', { userId, presence: 'online' });

    req.on('close', () => {
      unsubscribe();
      // Only mark the member away once their last tab has closed.
      if (connectedUserIds().includes(userId)) return;
      const grace = new Date(Date.now() - OFFLINE_GRACE_MS).toISOString();
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(grace, userId);
      publish([userId, ...audience], 'presence', { userId, presence: 'offline' });
    });
  }),
);

router.get(
  '/presence',
  route(async (req, res) => {
    const connected = new Set(connectedUserIds());
    const ids = new Set([...connected, ...presenceAudience(req.user.id)]);
    const rows = ids.size
      ? db.prepare(`SELECT * FROM users WHERE id IN (${[...ids].map(() => '?').join(',')})`).all(...ids)
      : [];
    res.json({
      users: rows.map((user) => ({
        id: user.id,
        presence: connected.has(user.id) ? effectivePresence({ ...user, last_seen_at: nowIso() }) : effectivePresence(user),
      })),
    });
  }),
);
