import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, nowIso } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { publicUser } from '../lib/presenters.js';
import { rateLimit } from '../lib/rate-limit.js';
import { P, channelPermissions, has } from '../lib/server-perms.js';
import { memberIds, publish, publishToConversation } from '../lib/realtime.js';
import { notifyConversationMessage } from '../lib/notifications.js';
import { audit } from '../lib/sessions.js';
import {
  canDirectMessage,
  conversationAudience,
  conversationMemberRows,
  conversationSummary,
  messageFor,
  requireConversation,
  requireMembership,
  userRow,
} from '../lib/social.js';
import { requireUser } from './me.js';

export const router = Router();
export const messagesRouter = Router();

for (const instance of [router, messagesRouter]) {
  instance.use(requireUser);
  instance.use((req, _res, next) => {
    req.rateLimitKey = req.user.id;
    next();
  });
}

const MAX_BODY = 4000;

/** Messages differ per viewer because reactions carry a "did I react" flag. */
function publishMessage(conversationId, event, row) {
  for (const memberId of conversationAudience({ id: conversationId })) {
    publish(memberId, event, { conversationId, message: messageFor(row, memberId) });
  }
}

function memberIdsOf(conversationId) {
  return memberIds(conversationId);
}

function summaryFor(conversationId, viewerId) {
  return conversationSummary(requireConversation(conversationId), viewerId);
}

const dmKey = (a, b) => [a, b].sort().join(':');

/* -------------------------------------------------------------------------- */
/* Conversation list and creation                                             */
/* -------------------------------------------------------------------------- */

router.get(
  '/',
  route(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.* FROM conversations c
           JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
          ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
          LIMIT 200`,
      )
      .all(req.user.id);
    const conversations = rows.map((row) => conversationSummary(row, req.user.id));
    const totalUnread = conversations.reduce((sum, item) => sum + (item.muted ? 0 : item.unreadCount), 0);
    res.json({ conversations, totalUnread });
  }),
);

const createSchema = z.object({
  kind: z.enum(['dm', 'group']),
  userIds: z.array(z.string().uuid()).min(1).max(20),
  title: z.string().trim().min(1).max(60).optional(),
});

router.post(
  '/',
  rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'conversation-create' }),
  route(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Choose who to talk to.');
    const { kind, title } = parsed.data;
    const others = [...new Set(parsed.data.userIds)].filter((id) => id !== req.user.id);

    if (kind === 'dm') {
      if (others.length !== 1) return fail(400, 'invalid_input', 'Pick exactly one member for a direct message.');
      const target = userRow(others[0]);
      if (!target || target.is_banned) return fail(404, 'user_not_found', 'We could not find that member.');
      const allowed = canDirectMessage(req.user.id, target.id);
      if (!allowed.ok) return fail(403, allowed.reason === 'blocked' ? 'blocked' : 'privacy', allowed.message);

      const key = dmKey(req.user.id, target.id);
      const existing = db.prepare('SELECT * FROM conversations WHERE dm_key = ?').get(key);
      if (existing) {
        return res.json({ conversation: conversationSummary(existing, req.user.id), existed: true });
      }

      const id = randomUUID();
      const now = nowIso();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO conversations (id, kind, dm_key, created_by, created_at, updated_at)
           VALUES (?, 'dm', ?, ?, ?, ?)`,
        ).run(id, key, req.user.id, now, now);
        db.prepare(
          `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
           VALUES (?, ?, 'member', ?, ?)`,
        ).run(id, req.user.id, now, now);
        db.prepare(
          `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at)
           VALUES (?, ?, 'member', ?)`,
        ).run(id, target.id, now);
      })();
      const row = requireConversation(id);
      for (const memberId of memberIdsOf(id)) {
        publish(memberId, 'conversation:new', { conversation: conversationSummary(row, memberId) });
      }
      return res.status(201).json({ conversation: conversationSummary(row, req.user.id), existed: false });
    }

    if (others.length === 0) return fail(400, 'invalid_input', 'Add at least one other member.');
    const members = [req.user.id, ...others];
    for (const memberId of members) {
      if (!userRow(memberId)) return fail(404, 'user_not_found', 'One of those members no longer exists.');
    }

    const id = randomUUID();
    const now = nowIso();
    const groupTitle = (title || 'New group').slice(0, 60);
    db.transaction(() => {
      db.prepare(
        `INSERT INTO conversations (id, kind, title, created_by, created_at, updated_at)
         VALUES (?, 'group', ?, ?, ?, ?)`,
      ).run(id, groupTitle, req.user.id, now, now);
      members.forEach((memberId, index) => {
        db.prepare(
          `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(id, memberId, index === 0 ? 'owner' : 'member', now, index === 0 ? now : null);
      });
    })();
    const row = requireConversation(id);
    for (const memberId of memberIdsOf(id)) {
      publish(memberId, 'conversation:new', { conversation: conversationSummary(row, memberId) });
    }
    audit(req.user.id, 'conversation.created', { targetType: 'conversation', targetId: id, ip: clientIp(req) });
    res.status(201).json({ conversation: conversationSummary(row, req.user.id), existed: false });
  }),
);

router.get(
  '/:id',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const row = requireConversation(req.params.id);
    const members = conversationMemberRows(row.id).map((member) => ({
      user: publicUser(userRow(member.user_id)),
      role: member.role,
      joinedAt: member.joined_at,
      muted: Boolean(member.muted),
      lastReadAt: member.last_read_at,
    }));
    res.json({ conversation: conversationSummary(row, req.user.id), members: members.filter((entry) => entry.user) });
  }),
);

const updateSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  iconMediaId: z.string().uuid().nullable().optional(),
});

router.patch(
  '/:id',
  route(async (req, res) => {
    const membership = requireMembership(req.params.id, req.user.id);
    const row = requireConversation(req.params.id);
    if (row.kind !== 'group') return fail(400, 'not_a_group', 'Only group conversations can be edited.');
    if (membership.role !== 'owner') return fail(403, 'not_owner', 'Only the group owner can change these settings.');

    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Check the group name and icon.');

    const fields = [];
    const values = [];
    if (parsed.data.title !== undefined) {
      fields.push('title = ?');
      values.push(parsed.data.title);
    }
    if (parsed.data.iconMediaId !== undefined) {
      if (parsed.data.iconMediaId) {
        const media = db
          .prepare('SELECT id FROM media WHERE id = ? AND owner_id = ?')
          .get(parsed.data.iconMediaId, req.user.id);
        if (!media) return fail(404, 'media_not_found', 'Upload the icon again.');
      }
      fields.push('icon_media_id = ?');
      values.push(parsed.data.iconMediaId);
    }
    if (fields.length === 0) return res.json({ conversation: conversationSummary(row, req.user.id) });

    fields.push('updated_at = ?');
    values.push(nowIso(), row.id);
    db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    publishToConversation(row.id, 'conversation:update', { conversationId: row.id });
    res.json({ conversation: summaryFor(row.id, req.user.id) });
  }),
);

const membersSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(20) });

router.post(
  '/:id/members',
  rateLimit({ windowMs: 60 * 1000, max: 40, keyPrefix: 'conversation-add' }),
  route(async (req, res) => {
    const membership = requireMembership(req.params.id, req.user.id);
    const row = requireConversation(req.params.id);
    if (row.kind !== 'group') return fail(400, 'not_a_group', 'Only group conversations have member lists.');
    if (membership.role !== 'owner') return fail(403, 'not_owner', 'Only the group owner can add members.');

    const parsed = membersSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Choose at least one member to add.');

    const now = nowIso();
    const added = [];
    for (const userId of [...new Set(parsed.data.userIds)]) {
      if (!userRow(userId)) continue;
      const already = db
        .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
        .get(row.id, userId);
      if (already) continue;
      db.prepare(
        `INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
      ).run(row.id, userId, now);
      added.push(userId);
    }
    if (added.length === 0) return fail(409, 'already_members', 'Everyone you picked is already in this conversation.');
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, row.id);

    for (const memberId of memberIdsOf(row.id)) {
      publish(memberId, 'conversation:new', { conversation: conversationSummary(row, memberId) });
    }
    res.json({ added, conversation: summaryFor(row.id, req.user.id) });
  }),
);

function leaveConversation(conversationId, userId) {
  const row = requireConversation(conversationId);
  const membership = db
    .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!membership) return false;

  db.transaction(() => {
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId);
    if (row.kind === 'group') {
      const remaining = conversationMemberRows(conversationId);
      if (remaining.length === 0) {
        db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
        return;
      }
      if (membership.role === 'owner') {
        db.prepare(`UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?`).run(
          conversationId,
          remaining[0].user_id,
        );
      }
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversationId);
    }
  })();
  return true;
}

router.post(
  '/:id/leave',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    leaveConversation(req.params.id, req.user.id);
    publish(req.user.id, 'conversation:removed', { conversationId: req.params.id });
    publishToConversation(req.params.id, 'conversation:update', { conversationId: req.params.id });
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id/members/:userId',
  route(async (req, res) => {
    const membership = requireMembership(req.params.id, req.user.id);
    const row = requireConversation(req.params.id);
    const targetId = req.params.userId;
    if (row.kind !== 'group') return fail(400, 'not_a_group', 'Only group conversations have members.');
    if (targetId !== req.user.id && membership.role !== 'owner') {
      return fail(403, 'not_owner', 'Only the group owner can remove members.');
    }
    const removed = leaveConversation(row.id, targetId);
    if (!removed) return fail(404, 'member_not_found', 'That member is not in this conversation.');
    publish(targetId, 'conversation:removed', { conversationId: row.id });
    publishToConversation(row.id, 'conversation:update', { conversationId: row.id });
    res.json({ ok: true });
  }),
);

const prefsSchema = z.object({ muted: z.boolean().optional(), archived: z.boolean().optional() });

router.patch(
  '/:id/preferences',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const parsed = prefsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Check those conversation settings.');
    const fields = [];
    const values = [];
    if (parsed.data.muted !== undefined) {
      fields.push('muted = ?');
      values.push(parsed.data.muted ? 1 : 0);
    }
    if (parsed.data.archived !== undefined) {
      fields.push('archived = ?');
      values.push(parsed.data.archived ? 1 : 0);
    }
    if (fields.length === 0) return res.json({ conversation: summaryFor(req.params.id, req.user.id) });
    values.push(req.params.id, req.user.id);
    db.prepare(`UPDATE conversation_members SET ${fields.join(', ')} WHERE conversation_id = ? AND user_id = ?`).run(
      ...values,
    );
    res.json({ conversation: summaryFor(req.params.id, req.user.id) });
  }),
);

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

router.get(
  '/:id/messages',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const beforeId = typeof req.query.beforeId === 'string' ? req.query.beforeId : null;

    const rows = before
      ? db
          .prepare(
            `SELECT * FROM messages
              WHERE conversation_id = ?
                AND thread_root_id IS NULL
                AND (created_at < ? OR (created_at = ? AND id < ?))
              ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(req.params.id, before, before, beforeId || 'ffffffff', limit + 1)
      : db
          .prepare(
            'SELECT * FROM messages WHERE conversation_id = ? AND thread_root_id IS NULL ORDER BY created_at DESC, id DESC LIMIT ?',
          )
          .all(req.params.id, limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    res.json({ messages: page.map((row) => messageFor(row, req.user.id)), hasMore });
  }),
);

const sendSchema = z.object({
  body: z.string().max(MAX_BODY).optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
  replyToId: z.string().uuid().nullable().optional(),
  threadRootId: z.string().uuid().nullable().optional(),
  poll: z
    .object({
      question: z.string().min(1).max(300),
      options: z.array(z.string().min(1).max(120)).min(2).max(10),
      multiple: z.boolean().optional(),
    })
    .optional(),
});

router.post(
  '/:id/messages',
  rateLimit({ windowMs: 10 * 1000, max: 20, keyPrefix: 'message-send' }),
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    // Server channels enforce their own send rules: read-only channels only accept staff posts.
    const channelRow = db.prepare('SELECT * FROM server_channels WHERE conversation_id = ?').get(req.params.id);
    if (channelRow) {
      const permissions = channelPermissions(channelRow.server_id, req.user.id, channelRow.id);
      if (!has(permissions, P.SEND_MESSAGES)) {
        return fail(403, 'cannot_send', 'You do not have permission to send messages in this channel.');
      }
      if (channelRow.read_only && !has(permissions, P.MANAGE_MESSAGES)) {
        return fail(403, 'channel_read_only', 'This channel is read-only. Only staff can post here.');
      }
    }
    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'That message could not be sent.');

    const body = (parsed.data.body || '').replace(/\r\n/g, '\n').trim();
    const attachmentIds = parsed.data.attachmentIds || [];
    const pollInput = parsed.data.poll
      ? {
          question: parsed.data.poll.question.trim(),
          options: parsed.data.poll.options.map((option) => option.trim()).filter(Boolean),
          multiple: Boolean(parsed.data.poll.multiple),
        }
      : null;
    if (pollInput && !pollInput.question) {
      return fail(400, 'invalid_poll', 'Add a question for your poll.');
    }
    if (pollInput && pollInput.options.length < 2) {
      return fail(400, 'invalid_poll', 'A poll needs at least two options.');
    }
    if (!body && attachmentIds.length === 0 && !pollInput) return fail(400, 'empty_message', 'Write something before sending.');
    if (body.length > MAX_BODY) return fail(400, 'message_too_long', 'Messages can be up to 4000 characters.');

    if (attachmentIds.length > 0) {
      const owned = db
        .prepare(
          `SELECT COUNT(*) AS total FROM media
            WHERE kind = 'attachment' AND owner_id = ? AND id IN (${attachmentIds.map(() => '?').join(',')})`,
        )
        .get(req.user.id, ...attachmentIds).total;
      if (owned !== attachmentIds.length) return fail(403, 'attachment_denied', 'One of those files is not yours.');
    }

    if (parsed.data.replyToId) {
      const reply = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(parsed.data.replyToId);
      if (!reply || reply.conversation_id !== req.params.id) {
        return fail(400, 'invalid_reply', 'You can only reply to messages in this conversation.');
      }
    }

    // Thread replies stay in the conversation but hang off the message that started the thread.
    let threadRootId = parsed.data.threadRootId || null;
    if (threadRootId) {
      const root = db
        .prepare('SELECT id, thread_root_id FROM messages WHERE id = ? AND conversation_id = ?')
        .get(threadRootId, req.params.id);
      if (!root) return fail(400, 'invalid_thread', 'That thread is no longer available.');
      if (root.thread_root_id) return fail(400, 'nested_thread', 'Threads cannot be nested.');
      threadRootId = root.id;
    }

    const id = randomUUID();
    const createdAt = nowIso();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, author_id, body, reply_to_id, thread_root_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, req.params.id, req.user.id, body, parsed.data.replyToId || null, threadRootId, createdAt);
      if (pollInput) {
        db.prepare('INSERT INTO message_polls (message_id, question, multiple, created_at) VALUES (?, ?, ?, ?)').run(
          id,
          pollInput.question,
          pollInput.multiple ? 1 : 0,
          createdAt,
        );
        pollInput.options.forEach((label, index) => {
          db.prepare('INSERT INTO message_poll_options (id, message_id, label, position) VALUES (?, ?, ?, ?)').run(
            randomUUID(),
            id,
            label,
            index,
          );
        });
      }
      for (const mediaId of attachmentIds) {
        db.prepare('INSERT INTO message_attachments (id, message_id, media_id, created_at) VALUES (?, ?, ?, ?)').run(
          randomUUID(),
          id,
          mediaId,
          createdAt,
        );
      }
      if (!threadRootId) {
        db.prepare('UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?').run(
          createdAt,
          createdAt,
          req.params.id,
        );
      }
      db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(
        createdAt,
        req.params.id,
        req.user.id,
      );
    })();

    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    publishMessage(req.params.id, 'message:new', row);
    notifyConversationMessage({
      conversationId: req.params.id,
      authorId: req.user.id,
      messageId: row.id,
      body,
    });
    res.status(201).json({ message: messageFor(row, req.user.id) });
  }),
);

const editSchema = z.object({ body: z.string().min(1).max(MAX_BODY) });

router.patch(
  '/:id/messages/:messageId',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const row = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, req.params.id);
    if (!row || row.deleted_at) return fail(404, 'message_not_found', 'That message is no longer available.');
    if (row.author_id !== req.user.id) return fail(403, 'not_author', 'You can only edit your own messages.');

    const parsed = editSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Messages can be up to 4000 characters.');
    const body = parsed.data.body.replace(/\r\n/g, '\n').trim();
    if (!body) return fail(400, 'empty_message', 'Write something before saving.');

    db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(body, nowIso(), row.id);
    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(row.id);
    publishMessage(req.params.id, 'message:update', fresh);
    res.json({ message: messageFor(fresh, req.user.id) });
  }),
);

router.delete(
  '/:id/messages/:messageId',
  route(async (req, res) => {
    const membership = requireMembership(req.params.id, req.user.id);
    const row = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, req.params.id);
    if (!row || row.deleted_at) return fail(404, 'message_not_found', 'That message is no longer available.');

    const conversation = requireConversation(req.params.id);
    const canModerate = conversation.kind === 'group' && membership.role === 'owner';
    if (row.author_id !== req.user.id && !canModerate) {
      return fail(403, 'not_allowed', 'You can only delete your own messages.');
    }

    db.prepare('UPDATE messages SET deleted_at = ?, body = ?, pinned_at = NULL WHERE id = ?').run(
      nowIso(),
      '',
      row.id,
    );
    publish(req.params.id ? memberIdsOf(req.params.id) : [], 'message:delete', {
      conversationId: req.params.id,
      messageId: row.id,
    });
    audit(req.user.id, 'message.deleted', { targetType: 'message', targetId: row.id, ip: clientIp(req) });
    res.json({ ok: true, messageId: row.id });
  }),
);

const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(16) });

router.post(
  '/:id/messages/:messageId/reactions',
  rateLimit({ windowMs: 10 * 1000, max: 40, keyPrefix: 'reaction' }),
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const row = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, req.params.id);
    if (!row || row.deleted_at) return fail(404, 'message_not_found', 'That message is no longer available.');

    const parsed = reactionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Pick a valid reaction.');
    const emoji = parsed.data.emoji;

    const existing = db
      .prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .get(row.id, req.user.id, emoji);
    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(
        row.id,
        req.user.id,
        emoji,
      );
    } else {
      db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(
        row.id,
        req.user.id,
        emoji,
        nowIso(),
      );
    }
    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(row.id);
    publishMessage(req.params.id, 'message:update', fresh);
    res.json({ message: messageFor(fresh, req.user.id) });
  }),
);

router.post(
  '/:id/messages/:messageId/pin',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const row = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, req.params.id);
    if (!row || row.deleted_at) return fail(404, 'message_not_found', 'That message is no longer available.');
    const pinnedAt = row.pinned_at ? null : nowIso();
    db.prepare('UPDATE messages SET pinned_at = ? WHERE id = ?').run(pinnedAt, row.id);
    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(row.id);
    publishMessage(req.params.id, 'message:update', fresh);
    res.json({ message: messageFor(fresh, req.user.id), pinned: Boolean(pinnedAt) });
  }),
);

router.get(
  '/:id/pins',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const rows = db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? AND pinned_at IS NOT NULL AND deleted_at IS NULL
          ORDER BY pinned_at DESC LIMIT 50`,
      )
      .all(req.params.id);
    res.json({ messages: rows.map((row) => messageFor(row, req.user.id)) });
  }),
);

const voteSchema = z.object({ optionIds: z.array(z.string().uuid()).min(1).max(10) });

router.post(
  '/:id/messages/:messageId/vote',
  rateLimit({ windowMs: 10 * 1000, max: 30, keyPrefix: 'poll-vote' }),
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const row = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, req.params.id);
    if (!row || row.deleted_at) return fail(404, 'message_not_found', 'That message is no longer available.');

    const poll = db.prepare('SELECT * FROM message_polls WHERE message_id = ?').get(row.id);
    if (!poll) return fail(404, 'poll_not_found', 'That poll is no longer available.');

    const parsed = voteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Choose an option before voting.');

    const validIds = new Set(
      db.prepare('SELECT id FROM message_poll_options WHERE message_id = ?').all(row.id).map((option) => option.id),
    );
    const chosen = [...new Set(parsed.data.optionIds)].filter((optionId) => validIds.has(optionId));
    if (chosen.length === 0) return fail(400, 'invalid_option', 'That poll option does not exist.');
    if (!poll.multiple && chosen.length > 1) return fail(400, 'single_choice', 'This poll allows one choice.');

    db.transaction(() => {
      if (poll.multiple) {
        // Multiple choice: each selected option toggles independently.
        for (const optionId of chosen) {
          const existing = db
            .prepare('SELECT 1 AS present FROM message_poll_votes WHERE option_id = ? AND user_id = ?')
            .get(optionId, req.user.id);
          if (existing) {
            db.prepare('DELETE FROM message_poll_votes WHERE option_id = ? AND user_id = ?').run(optionId, req.user.id);
          } else {
            db.prepare(
              'INSERT INTO message_poll_votes (message_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)',
            ).run(row.id, optionId, req.user.id, nowIso());
          }
        }
        return;
      }
      // Single choice: voting the current option again withdraws the vote.
      const current = db
        .prepare('SELECT option_id FROM message_poll_votes WHERE message_id = ? AND user_id = ?')
        .get(row.id, req.user.id);
      const withdrawing = current?.option_id === chosen[0];
      db.prepare('DELETE FROM message_poll_votes WHERE message_id = ? AND user_id = ?').run(row.id, req.user.id);
      if (!withdrawing) {
        db.prepare('INSERT INTO message_poll_votes (message_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(
          row.id,
          chosen[0],
          req.user.id,
          nowIso(),
        );
      }
    })();

    const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(row.id);
    publishMessage(req.params.id, 'message:update', fresh);
    res.json({ message: messageFor(fresh, req.user.id) });
  }),
);

router.get(
  '/:id/messages/:messageId/thread',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const root = db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(req.params.messageId, req.params.id);
    if (!root) return fail(404, 'message_not_found', 'That thread is no longer available.');
    if (root.thread_root_id) {
      const parent = db.prepare('SELECT * FROM messages WHERE id = ?').get(root.thread_root_id);
      if (!parent) return fail(404, 'message_not_found', 'That thread is no longer available.');
      return res.json({ root: messageFor(parent, req.user.id), replies: [messageFor(root, req.user.id)] });
    }

    const replies = db
      .prepare('SELECT * FROM messages WHERE thread_root_id = ? ORDER BY created_at ASC, id ASC LIMIT 100')
      .all(root.id);
    res.json({ root: messageFor(root, req.user.id), replies: replies.map((reply) => messageFor(reply, req.user.id)) });
  }),
);

const readSchema = z.object({ messageId: z.string().uuid().optional() });

router.post(
  '/:id/read',
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const parsed = readSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'That read receipt could not be recorded.');

    let readAt = nowIso();
    if (parsed.data.messageId) {
      const message = db
        .prepare('SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?')
        .get(parsed.data.messageId, req.params.id);
      if (message) readAt = message.created_at;
    }
    db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(
      readAt,
      req.params.id,
      req.user.id,
    );
    for (const memberId of memberIdsOf(req.params.id)) {
      if (memberId === req.user.id) continue;
      publish(memberId, 'read', { conversationId: req.params.id, userId: req.user.id, lastReadAt: readAt });
    }
    res.json({ ok: true, lastReadAt: readAt });
  }),
);

const typingSchema = z.object({ typing: z.boolean() });

router.post(
  '/:id/typing',
  rateLimit({ windowMs: 10 * 1000, max: 30, keyPrefix: 'typing' }),
  route(async (req, res) => {
    requireMembership(req.params.id, req.user.id);
    const parsed = typingSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'Invalid typing signal.');
    for (const memberId of memberIdsOf(req.params.id)) {
      if (memberId === req.user.id) continue;
      publish(memberId, 'typing', {
        conversationId: req.params.id,
        user: publicUser(req.user),
        typing: parsed.data.typing,
      });
    }
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------------------- */
/* Global message search (only conversations you belong to)                    */
/* -------------------------------------------------------------------------- */

messagesRouter.get(
  '/search',
  route(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2) return fail(400, 'query_too_short', 'Type at least two characters to search.');
    const like = `%${query.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    const rows = db
      .prepare(
        `SELECT msg.* FROM messages msg
           JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = ?
          WHERE msg.deleted_at IS NULL AND msg.body LIKE ? ESCAPE '\\'
          ORDER BY msg.created_at DESC LIMIT 40`,
      )
      .all(req.user.id, like);
    res.json({
      results: rows.map((row) => ({
        message: messageFor(row, req.user.id),
        conversation: conversationSummary(requireConversation(row.conversation_id), req.user.id),
      })),
    });
  }),
);
