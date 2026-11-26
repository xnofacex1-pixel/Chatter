import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { fail, route } from '../lib/http.js';
import { actorsFor, notificationView, unreadCount } from '../lib/notifications.js';
import { requireUser } from './me.js';

export const router = Router();

router.get(
  '/',
  route(async (req, res) => {
    const user = requireUser(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(user.id, limit);
    const actors = actorsFor(rows);
    res.json({
      notifications: rows.map((row) => notificationView(row, row.actor_id ? actors.get(row.actor_id) ?? null : null)),
      unread: unreadCount(user.id),
    });
  }),
);

router.get(
  '/unread',
  route(async (req, res) => {
    const user = requireUser(req);
    res.json({ unread: unreadCount(user.id) });
  }),
);

router.post(
  '/read-all',
  route(async (req, res) => {
    const user = requireUser(req);
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), user.id);
    res.json({ ok: true, unread: 0 });
  }),
);

// Defined before /:id so "read" is never treated as a notification id.
router.delete(
  '/read',
  route(async (req, res) => {
    const user = requireUser(req);
    const result = db.prepare('DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL').run(user.id);
    res.json({ ok: true, removed: result.changes, unread: unreadCount(user.id) });
  }),
);

router.post(
  '/:id/read',
  route(async (req, res) => {
    const user = requireUser(req);
    const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, user.id);
    if (!row) fail(404, 'notification_not_found', 'That notification is no longer available.');
    if (!row.read_at) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), row.id);
    res.json({ ok: true, unread: unreadCount(user.id) });
  }),
);

router.delete(
  '/:id',
  route(async (req, res) => {
    const user = requireUser(req);
    const row = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, user.id);
    if (!row) fail(404, 'notification_not_found', 'That notification is no longer available.');
    db.prepare('DELETE FROM notifications WHERE id = ?').run(row.id);
    res.json({ ok: true, unread: unreadCount(user.id) });
  }),
);
