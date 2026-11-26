import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { db, nowIso, uploadsPath } from '../db.js';
import { clientIp, fail, route } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';
import { audit } from '../lib/sessions.js';
import { staffPermissions } from '../lib/admin.js';
import { requireUser } from './me.js';

/**
 * Support tickets.
 *
 * A ticket belongs to exactly one user and is readable by that user plus staff
 * holding the `support.tickets` permission (the owner implicitly holds it).
 * Internal notes are never returned to the ticket owner and never increment the
 * owner's unread counter.
 */

export const router = Router();
router.use(requireUser);

export const TICKET_CATEGORIES = [
  'account',
  'friends',
  'servers',
  'voice',
  'ai',
  'bugs',
  'safety',
  'other',
];

export const TICKET_CATEGORY_LABELS = {
  account: 'Account and Login',
  friends: 'Friends and Messages',
  servers: 'Servers and Channels',
  voice: 'Voice and Video',
  ai: 'Chatter AI',
  bugs: 'Bugs and Technical Issues',
  safety: 'Safety and Reports',
  other: 'Other',
};

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];

export const TICKET_STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_user: 'Waiting for User',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const MAX_BYTES = 10 * 1024 * 1024;
const TICKET_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/zip': 'zip',
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

const isOwner = (userId) =>
  Boolean(userId && db.prepare('SELECT is_owner FROM users WHERE id = ?').get(userId)?.is_owner);

export const canManageTickets = (userId) =>
  isOwner(userId) || (userId ? staffPermissions(userId).includes('support.tickets') : false);

function requireStaff(req) {
  if (!req.user) fail(401, 'auth_required', 'Sign in to continue.');
  if (!canManageTickets(req.user.id)) {
    fail(403, 'permission_required', 'Support tools are limited to Chatter staff.');
  }
  return req.user;
}

const parseAttachments = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const userSummary = (userId) => {
  if (!userId) return null;
  const row = db
    .prepare('SELECT id, username, display_name, avatar_media_id, is_owner, title FROM users WHERE id = ?')
    .get(userId);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_media_id ? `/api/media/${row.avatar_media_id}` : null,
    isOwner: Boolean(row.is_owner),
    title: row.title,
  };
};

function ticketSummary(row, viewerId) {
  const staff = canManageTickets(viewerId);
  const last = db
    .prepare(
      `SELECT body, created_at, is_internal, author_id FROM support_ticket_messages
        WHERE ticket_id = ? ${staff ? '' : 'AND is_internal = 0'}
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(row.id);
  const count = db.prepare('SELECT COUNT(*) AS n FROM support_ticket_messages WHERE ticket_id = ?').get(row.id).n;
  return {
    id: row.id,
    subject: row.subject,
    category: row.category,
    categoryLabel: TICKET_CATEGORY_LABELS[row.category] ?? row.category,
    priority: row.priority,
    status: row.status,
    statusLabel: TICKET_STATUS_LABELS[row.status] ?? row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReplyAt: row.last_reply_at,
    closedAt: row.closed_at,
    unread: staff ? row.staff_unread > 0 : row.user_unread > 0,
    messageCount: count,
    preview: last ? last.body.slice(0, 140) : '',
    owner: staff ? userSummary(row.user_id) : null,
    assignee: row.assigned_to ? userSummary(row.assigned_to) : null,
  };
}

const messageView = (row) => ({
  id: row.id,
  body: row.body,
  internal: Boolean(row.is_internal),
  createdAt: row.created_at,
  author: userSummary(row.author_id),
  attachments: parseAttachments(row.attachments),
});

function ticketForStaff(ticketId) {
  return db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId);
}

function ownTicket(ticketId, userId) {
  return db.prepare('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?').get(ticketId, userId);
}

const attachmentSchema = z
  .array(z.string().trim().min(8).max(80))
  .max(5)
  .optional()
  .default([]);

const createSchema = z.object({
  subject: z.string().trim().min(3, 'Give your ticket a short subject.').max(140),
  description: z.string().trim().min(5, 'Describe what happened so we can help.').max(8000),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES).optional().default('normal'),
  attachments: attachmentSchema,
});

const replySchema = z.object({
  body: z.string().trim().min(1, 'Write a message first.').max(8000),
  attachments: attachmentSchema,
  internal: z.boolean().optional().default(false),
});

/** Media rows referenced by a ticket the viewer may read. */
function ticketAttachment(mediaId, viewerId) {
  const media = db.prepare("SELECT * FROM media WHERE id = ? AND kind = 'ticket_attachment'").get(mediaId);
  if (!media) return null;
  const staff = canManageTickets(viewerId);
  const rows = db
    .prepare('SELECT ticket_id, attachments FROM support_ticket_messages WHERE attachments LIKE ?')
    .all(`%${mediaId}%`);
  const referenced = rows.some((row) => parseAttachments(row.attachments).some((entry) => entry?.id === mediaId));
  if (!referenced) return null;
  if (staff) return media;
  const ownsTicket = rows.some((row) => Boolean(ownTicket(row.ticket_id, viewerId)));
  return ownsTicket ? media : null;
}

function assertAttachmentOwnership(ids, userId) {
  for (const id of ids) {
    const media = db.prepare("SELECT * FROM media WHERE id = ? AND kind = 'ticket_attachment'").get(id);
    if (!media || media.owner_id !== userId) {
      fail(400, 'invalid_attachment', 'One of those files could not be attached. Upload it again.');
    }
  }
}

function notifyUser(userId, ticket, title, body, actorId) {
  if (!userId) return;
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link, actor_id, created_at)
     VALUES (?, ?, 'support_reply', ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, title, body, `/support?ticket=${ticket.id}`, actorId ?? null, nowIso());
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

router.get(
  '/meta',
  route(async (req, res) => {
    res.json({
      categories: TICKET_CATEGORIES.map((value) => ({ value, label: TICKET_CATEGORY_LABELS[value] })),
      statuses: TICKET_STATUSES.map((value) => ({ value, label: TICKET_STATUS_LABELS[value] })),
      priorities: TICKET_PRIORITIES,
      staff: canManageTickets(req.user.id),
    });
  }),
);

// ---------------------------------------------------------------------------
// Attachments (screenshots and supported files)
// ---------------------------------------------------------------------------

router.post(
  '/attachments',
  rateLimit({ windowMs: 60 * 1000, max: 20, keyPrefix: 'ticket-upload' }),
  upload.single('file'),
  route(async (req, res) => {
    if (!req.file) return fail(400, 'no_file', 'Choose a file to upload.');
    const extension = TICKET_TYPES[req.file.mimetype];
    if (!extension) return fail(415, 'unsupported_type', 'Attach an image, video, PDF, text file or ZIP archive.');
    if (req.file.size === 0) return fail(400, 'empty_file', 'That file is empty.');
    if (req.file.size > MAX_BYTES) return fail(413, 'file_too_large', 'Files must be 10 MB or smaller.');

    const id = randomUUID();
    const filename = `${id}.${extension}`;
    fs.writeFileSync(path.join(uploadsPath, filename), req.file.buffer, { mode: 0o600 });
    db.prepare(
      `INSERT INTO media (id, owner_id, kind, mime, byte_size, storage_path, created_at)
       VALUES (?, ?, 'ticket_attachment', ?, ?, ?, ?)`,
    ).run(id, req.user.id, req.file.mimetype, req.file.size, filename, nowIso());

    res.status(201).json({
      attachment: {
        id,
        url: `/api/support/attachments/${id}`,
        mime: req.file.mimetype,
        byteSize: req.file.size,
        name: path.basename(req.file.originalname || `file.${extension}`).slice(0, 120),
      },
    });
  }),
);

router.get(
  '/attachments/:id',
  route(async (req, res) => {
    const media = ticketAttachment(req.params.id, req.user.id);
    if (!media) return fail(404, 'attachment_not_found', 'That file is not available.');
    const absolute = path.join(uploadsPath, media.storage_path);
    if (!fs.existsSync(absolute)) return fail(404, 'attachment_missing', 'That file is no longer stored.');

    const inline = media.mime.startsWith('image/') || media.mime === 'application/pdf' || media.mime.startsWith('video/');
    res.set({
      'Content-Type': media.mime,
      'Content-Length': String(media.byte_size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="chatter-ticket-${media.id.slice(0, 8)}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.sendFile(absolute);
  }),
);

// ---------------------------------------------------------------------------
// Staff queue — declared before /:id so "staff" is never treated as a ticket id
// ---------------------------------------------------------------------------

router.get(
  '/staff/stats',
  route(async (req, res) => {
    requireStaff(req);
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status').all();
    const counts = Object.fromEntries(TICKET_STATUSES.map((status) => [status, 0]));
    for (const row of rows) counts[row.status] = row.n;
    const unassigned = db
      .prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE assigned_to IS NULL AND status NOT IN ('closed','resolved')")
      .get().n;
    const unread = db.prepare('SELECT COUNT(*) AS n FROM support_tickets WHERE staff_unread > 0').get().n;
    const total = db.prepare('SELECT COUNT(*) AS n FROM support_tickets').get().n;
    res.json({ counts, unassigned, unread, total });
  }),
);

router.get(
  '/staff/staff',
  route(async (req, res) => {
    requireStaff(req);
    const rows = db
      .prepare(
        `SELECT DISTINCT u.id, u.username, u.display_name, u.is_owner, u.title
           FROM users u
          WHERE u.is_owner = 1
             OR u.id IN (SELECT user_id FROM staff_assignments WHERE revoked_at IS NULL)
          ORDER BY u.is_owner DESC, u.username ASC`,
      )
      .all();
    res.json({
      staff: rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        isOwner: Boolean(row.is_owner),
        title: row.title,
      })),
    });
  }),
);

router.get(
  '/staff/tickets',
  route(async (req, res) => {
    requireStaff(req);
    const status = String(req.query.status || '').trim();
    const query = String(req.query.query || '').trim();
    const assigned = String(req.query.assigned || '').trim();

    const where = [];
    const params = [];
    if (TICKET_STATUSES.includes(status)) {
      where.push('t.status = ?');
      params.push(status);
    }
    if (assigned === 'me') {
      where.push('t.assigned_to = ?');
      params.push(req.user.id);
    } else if (assigned === 'unassigned') {
      where.push('t.assigned_to IS NULL');
    } else if (assigned === 'open') {
      where.push("t.status NOT IN ('closed','resolved')");
    }
    if (query) {
      where.push('(LOWER(t.subject) LIKE ? OR LOWER(u.username) LIKE ? OR LOWER(u.email) LIKE ?)');
      const like = `%${query.toLowerCase()}%`;
      params.push(like, like, like);
    }

    const rows = db
      .prepare(
        `SELECT t.* FROM support_tickets t
           JOIN users u ON u.id = t.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                   t.updated_at DESC
          LIMIT 200`,
      )
      .all(...params);

    res.json({ tickets: rows.map((row) => ticketSummary(row, req.user.id)) });
  }),
);

router.get(
  '/staff/tickets/:id',
  route(async (req, res) => {
    requireStaff(req);
    const ticket = ticketForStaff(req.params.id);
    if (!ticket) return fail(404, 'ticket_not_found', 'That ticket no longer exists.');
    if (ticket.staff_unread > 0) {
      db.prepare('UPDATE support_tickets SET staff_unread = 0 WHERE id = ?').run(ticket.id);
      ticket.staff_unread = 0;
    }
    const messages = db
      .prepare('SELECT * FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC')
      .all(ticket.id);
    res.json({
      ticket: { ...ticketSummary(ticket, req.user.id), owner: userSummary(ticket.user_id) },
      messages: messages.map(messageView),
    });
  }),
);

router.post(
  '/staff/tickets/:id/messages',
  rateLimit({ windowMs: 60 * 1000, max: 60, keyPrefix: 'ticket-staff-reply' }),
  route(async (req, res) => {
    requireStaff(req);
    const ticket = ticketForStaff(req.params.id);
    if (!ticket) return fail(404, 'ticket_not_found', 'That ticket no longer exists.');
    const parsed = replySchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Write a message first.');
    const { body, attachments, internal } = parsed.data;
    assertAttachmentOwnership(attachments, req.user.id);

    const now = nowIso();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO support_ticket_messages (id, ticket_id, author_id, body, is_internal, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ticket.id, req.user.id, body, internal ? 1 : 0, JSON.stringify(attachments), now);

    if (internal) {
      db.prepare('UPDATE support_tickets SET updated_at = ? WHERE id = ?').run(now, ticket.id);
    } else {
      const nextStatus = ticket.status === 'open' ? 'in_progress' : ticket.status;
      db.prepare(
        `UPDATE support_tickets
            SET updated_at = ?, last_reply_at = ?, user_unread = user_unread + 1,
                assigned_to = COALESCE(assigned_to, ?), status = ?
          WHERE id = ?`,
      ).run(now, now, req.user.id, nextStatus, ticket.id);
      notifyUser(ticket.user_id, ticket, 'Support replied to your ticket', `${ticket.subject}: ${body.slice(0, 120)}`, req.user.id);
    }

    audit(req.user.id, internal ? 'support.note_added' : 'support.replied', {
      targetType: 'support_ticket',
      targetId: ticket.id,
      metadata: { internal: Boolean(internal) },
      ip: clientIp(req),
    });

    const fresh = ticketForStaff(ticket.id);
    res.status(201).json({
      message: messageView(db.prepare('SELECT * FROM support_ticket_messages WHERE id = ?').get(id)),
      ticket: ticketSummary(fresh, req.user.id),
    });
  }),
);

router.patch(
  '/staff/tickets/:id',
  route(async (req, res) => {
    requireStaff(req);
    const ticket = ticketForStaff(req.params.id);
    if (!ticket) return fail(404, 'ticket_not_found', 'That ticket no longer exists.');
    const parsed = z
      .object({
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        assignedTo: z.string().trim().max(80).nullable().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', 'That ticket update is not valid.');
    const { status, priority, assignedTo } = parsed.data;

    const now = nowIso();
    const sets = [];
    const params = [];
    if (status) {
      sets.push('status = ?');
      params.push(status);
      sets.push('closed_at = ?');
      params.push(status === 'closed' ? now : null);
    }
    if (priority) {
      sets.push('priority = ?');
      params.push(priority);
    }
    if (assignedTo !== undefined) {
      if (assignedTo) {
        const target = db.prepare('SELECT id FROM users WHERE id = ?').get(assignedTo);
        if (!target || !canManageTickets(target.id)) {
          return fail(400, 'invalid_assignee', 'Choose a Chatter staff member to assign this ticket to.');
        }
      }
      sets.push('assigned_to = ?');
      params.push(assignedTo || null);
    }
    if (sets.length === 0) return res.json({ ok: true, ticket: ticketSummary(ticket, req.user.id) });

    sets.push('updated_at = ?');
    params.push(now, ticket.id);
    db.prepare(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    audit(req.user.id, 'support.ticket_updated', {
      targetType: 'support_ticket',
      targetId: ticket.id,
      metadata: { status: status ?? null, priority: priority ?? null, assignedTo: assignedTo ?? null },
      ip: clientIp(req),
    });

    if (status && (status === 'resolved' || status === 'closed')) {
      notifyUser(
        ticket.user_id,
        ticket,
        status === 'resolved' ? 'Your support ticket was resolved' : 'Your support ticket was closed',
        ticket.subject,
        req.user.id,
      );
    }

    res.json({ ok: true, ticket: ticketSummary(ticketForStaff(ticket.id), req.user.id) });
  }),
);

// ---------------------------------------------------------------------------
// Ticket owner
// ---------------------------------------------------------------------------

router.get(
  '/',
  route(async (req, res) => {
    const status = String(req.query.status || '').trim();
    const rows = db
      .prepare(
        `SELECT * FROM support_tickets
          WHERE user_id = ? ${TICKET_STATUSES.includes(status) ? 'AND status = ?' : ''}
          ORDER BY updated_at DESC LIMIT 100`,
      )
      .all(...(TICKET_STATUSES.includes(status) ? [req.user.id, status] : [req.user.id]));
    res.json({ tickets: rows.map((row) => ticketSummary(row, req.user.id)) });
  }),
);

router.post(
  '/',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'ticket-create', message: 'You have opened several tickets recently. Try again later.' }),
  route(async (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Check the ticket details.');
    const { subject, description, category, priority, attachments } = parsed.data;
    assertAttachmentOwnership(attachments, req.user.id);

    const id = randomUUID();
    const now = nowIso();
    db.prepare(
      `INSERT INTO support_tickets
         (id, user_id, subject, category, priority, status, user_unread, staff_unread, created_at, updated_at, last_reply_at)
       VALUES (?, ?, ?, ?, ?, 'open', 0, 1, ?, ?, ?)`,
    ).run(id, req.user.id, subject, category, priority, now, now, now);
    db.prepare(
      `INSERT INTO support_ticket_messages (id, ticket_id, author_id, body, is_internal, attachments, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).run(randomUUID(), id, req.user.id, description, JSON.stringify(attachments), now);

    audit(req.user.id, 'support.ticket_created', {
      targetType: 'support_ticket',
      targetId: id,
      metadata: { category, priority },
      ip: clientIp(req),
    });

    const ticket = ticketForStaff(id);
    res.status(201).json({ ticket: ticketSummary(ticket, req.user.id) });
  }),
);

router.get(
  '/:id',
  route(async (req, res) => {
    const ticket = ownTicket(req.params.id, req.user.id);
    if (!ticket) return fail(404, 'ticket_not_found', 'That ticket was not found.');
    if (ticket.user_unread > 0) {
      db.prepare('UPDATE support_tickets SET user_unread = 0 WHERE id = ?').run(ticket.id);
      ticket.user_unread = 0;
    }
    const messages = db
      .prepare('SELECT * FROM support_ticket_messages WHERE ticket_id = ? AND is_internal = 0 ORDER BY created_at ASC')
      .all(ticket.id);
    res.json({ ticket: ticketSummary(ticket, req.user.id), messages: messages.map(messageView) });
  }),
);

router.post(
  '/:id/messages',
  rateLimit({ windowMs: 60 * 1000, max: 40, keyPrefix: 'ticket-reply' }),
  route(async (req, res) => {
    const ticket = ownTicket(req.params.id, req.user.id);
    if (!ticket) return fail(404, 'ticket_not_found', 'That ticket was not found.');
    if (ticket.status === 'closed') {
      return fail(409, 'ticket_closed', 'This ticket is closed. Reopen it to reply.');
    }
    const parsed = replySchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(400, 'invalid_input', parsed.error.issues[0]?.message || 'Write a message first.');
    const { body, attachments } = parsed.data;
    assertAttachmentOwnership(attachments, req.user.id);

    const now = nowIso();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO support_ticket_messages (id, ticket_id, author_id, body, is_internal, attachments, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, ticket.id, req.user.id, body, JSON.stringify(attachments), now);
    db.prepare(
      `UPDATE support_tickets
          SET updated_at = ?, last_reply_at = ?, staff_unread = staff_unread + 1,
              status = CASE WHEN status IN ('resolved','waiting_user') THEN 'open' ELSE status END
        WHERE id = ?`,
    ).run(now, now, ticket.id);

    if (ticket.assigned_to && ticket.assigned_to !== req.user.id) {
      db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, link, actor_id, created_at)
         VALUES (?, ?, 'support_reply', 'New reply on an assigned ticket', ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        ticket.assigned_to,
        `${ticket.subject}: ${body.slice(0, 120)}`,
        `/owner?section=support&ticket=${ticket.id}`,
        req.user.id,
        now,
      );
    }

    res.status(201).json({
      message: messageView(db.prepare('SELECT * FROM support_ticket_messages WHERE id = ?').get(id)),
      ticket: ticketSummary(ticketForStaff(ticket.id), req.user.id),
    });
  }),
);

router.post(
  '/:id/reopen',
  route(async (req, res) => {
    const ticket = ownTicket(req.params.id, req.user.id);
    if (!ticket) return fail(404, 'ticket_not_found', 'That ticket was not found.');
    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      return fail(409, 'ticket_open', 'This ticket is already open.');
    }
    const now = nowIso();
    db.prepare("UPDATE support_tickets SET status = 'open', closed_at = NULL, updated_at = ?, staff_unread = 1 WHERE id = ?").run(
      now,
      ticket.id,
    );
    audit(req.user.id, 'support.ticket_reopened', {
      targetType: 'support_ticket',
      targetId: ticket.id,
      ip: clientIp(req),
    });
    res.json({ ok: true, ticket: ticketSummary(ticketForStaff(ticket.id), req.user.id) });
  }),
);

router.post(
  '/:id/close',
  route(async (req, res) => {
    const ticket = ownTicket(req.params.id, req.user.id);
    if (!ticket) return fail(404, 'ticket_not_found', 'That ticket was not found.');
    const now = nowIso();
    db.prepare("UPDATE support_tickets SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?").run(
      now,
      now,
      ticket.id,
    );
    audit(req.user.id, 'support.ticket_closed', {
      targetType: 'support_ticket',
      targetId: ticket.id,
      ip: clientIp(req),
    });
    res.json({ ok: true, ticket: ticketSummary(ticketForStaff(ticket.id), req.user.id) });
  }),
);
