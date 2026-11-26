import { Router } from 'express';
import { db, nowIso } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';
import { requireUser } from './me.js';
import { joinServer } from '../lib/membership.js';
import { memberRow, requireServer, serverSummary } from '../lib/server-perms.js';

/**
 * Public invite links. Previewing and joining require a signed-in account, so
 * an anonymous visitor can never enumerate communities.
 */
export const router = Router();
router.use(requireUser);

const inviteRow = (code) =>
  db.prepare('SELECT * FROM server_invites WHERE code = ? AND revoked_at IS NULL').get(code);

function inviteState(invite) {
  const expired = invite.expires_at ? new Date(invite.expires_at).getTime() <= Date.now() : false;
  const exhausted = invite.max_uses > 0 && invite.uses >= invite.max_uses;
  return { expired, exhausted, valid: !expired && !exhausted };
}

function onlineCount(serverId) {
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT COUNT(*) AS total FROM server_members sm
         JOIN users u ON u.id = sm.user_id
        WHERE sm.server_id = ? AND u.last_seen_at > ? AND u.status <> 'invisible'`,
    )
    .get(serverId, threshold).total;
}

router.get(
  '/:code',
  route(async (req, res) => {
    const invite = inviteRow(req.params.code);
    if (!invite) fail(404, 'invite_invalid', 'That invite link is no longer valid.');
    const server = requireServer(invite.server_id);
    const state = inviteState(invite);
    const channel = invite.channel_id
      ? db.prepare('SELECT id, name, type FROM server_channels WHERE id = ?').get(invite.channel_id)
      : null;
    const inviter = invite.created_by
      ? db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(invite.created_by)
      : null;

    res.json({
      invite: {
        code: invite.code,
        valid: state.valid && !server.is_suspended,
        expired: state.expired,
        exhausted: state.exhausted,
        uses: invite.uses,
        maxUses: invite.max_uses,
        expiresAt: invite.expires_at,
        createdAt: invite.created_at,
      },
      server: {
        id: server.id,
        name: server.name,
        description: server.description,
        iconUrl: server.icon_media_id ? `/api/media/${server.icon_media_id}` : null,
        memberCount: db
          .prepare('SELECT COUNT(*) AS total FROM server_members WHERE server_id = ?')
          .get(server.id).total,
        onlineCount: onlineCount(server.id),
        isSuspended: Boolean(server.is_suspended),
      },
      channel,
      inviter: inviter
        ? { id: inviter.id, username: inviter.username, displayName: inviter.display_name }
        : null,
      alreadyMember: Boolean(memberRow(server.id, req.user.id)),
    });
  }),
);

router.post(
  '/:code',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyPrefix: 'invite-join' }),
  route(async (req, res) => {
    const invite = inviteRow(req.params.code);
    if (!invite) fail(404, 'invite_invalid', 'That invite link is no longer valid.');
    const state = inviteState(invite);
    if (!state.valid) {
      fail(
        410,
        state.expired ? 'invite_expired' : 'invite_exhausted',
        state.expired
          ? 'That invite has expired. Ask a member for a new one.'
          : 'That invite has reached its usage limit.',
      );
    }
    const server = requireServer(invite.server_id);
    const result = joinServer(server, req.user.id, { inviteId: invite.id, ip: clientIp(req) });
    if (!result.alreadyMember) {
      db.prepare('UPDATE server_invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
    }
    res.status(result.alreadyMember ? 200 : 201).json({
      server: serverSummary(requireServer(server.id), req.user.id),
      alreadyMember: result.alreadyMember,
    });
  }),
);
