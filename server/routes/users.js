import { Router } from 'express';
import { db } from '../db.js';
import { fail, route } from '../lib/http.js';
import { publicUser } from '../lib/presenters.js';
import { requireUser } from './me.js';

export const router = Router();

router.use(requireUser);

const MAX_PAGE = 60;

/** Member directory with search. Email addresses are never returned. */
router.get(
  '/',
  route(async (req, res) => {
    const query = String(req.query.q ?? '').trim().slice(0, 60);
    const limit = Math.min(Number(req.query.limit) || 40, MAX_PAGE);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = query
      ? db
          .prepare(
            `SELECT * FROM users
              WHERE (username LIKE ? OR display_name LIKE ?) AND is_banned = 0
              ORDER BY is_owner DESC, display_name COLLATE NOCASE ASC
              LIMIT ? OFFSET ?`,
          )
          .all(`%${query}%`, `%${query}%`, limit, offset)
      : db
          .prepare(
            `SELECT * FROM users
              WHERE is_banned = 0
              ORDER BY is_owner DESC, last_seen_at DESC
              LIMIT ? OFFSET ?`,
          )
          .all(limit, offset);

    const total = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_banned = 0').get().count;
    res.json({ users: rows.map((row) => publicUser(row)), total, query });
  }),
);

router.get(
  '/:username',
  route(async (req, res) => {
    const username = String(req.params.username || '').toLowerCase();
    const row = db.prepare('SELECT * FROM users WHERE username_lower = ?').get(username);
    if (!row) return fail(404, 'not_found', 'That member could not be found.');
    res.json({
      user: publicUser(row),
      memberSince: row.created_at,
      viewerIsSelf: row.id === req.user.id,
    });
  }),
);

export const statsRouter = Router();

statsRouter.get(
  '/stats',
  requireUser,
  route(async (_req, res) => {
    const online = db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE is_banned = 0 AND last_seen_at > ? AND status NOT IN ('invisible','offline')")
      .get(new Date(Date.now() - 2 * 60 * 1000).toISOString()).count;
    const total = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const verified = db.prepare('SELECT COUNT(*) AS count FROM users WHERE email_verified_at IS NOT NULL').get().count;
    const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const newThisWeek = db.prepare('SELECT COUNT(*) AS count FROM users WHERE created_at > ?').get(weekAgo).count;
    const owners = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_owner = 1').get().count;
    const recent = db
      .prepare('SELECT * FROM users WHERE is_banned = 0 ORDER BY created_at DESC LIMIT 6')
      .all()
      .map((row) => publicUser(row));

    res.json({
      stats: {
        totalUsers: total,
        onlineUsers: online,
        offlineUsers: Math.max(total - online, 0),
        verifiedUsers: verified,
        newThisWeek,
        owners,
        serverTime: new Date().toISOString(),
      },
      recentMembers: recent,
    });
  }),
);
