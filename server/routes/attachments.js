import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, nowIso, uploadsPath } from '../db.js';
import { fail, route } from '../lib/http.js';
import { rateLimit } from '../lib/rate-limit.js';
import { requireUser } from './me.js';

export const router = Router();
router.use(requireUser);
router.use((req, _res, next) => {
  req.rateLimitKey = req.user.id;
  next();
});

/** Documents, images and video that members may share inside conversations. */
const ALLOWED_TYPES = {
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

const MAX_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

export const ATTACHMENT_ROW = `SELECT m.* FROM media m WHERE m.id = ? AND m.kind = 'attachment'`;

/** A member may read an attachment only if they own it or share its conversation. */
export function canReadAttachment(mediaId, userId) {
  const media = db.prepare(ATTACHMENT_ROW).get(mediaId);
  if (!media) return null;
  if (media.owner_id === userId) return media;
  const shared = db
    .prepare(
      `SELECT 1 FROM message_attachments a
         JOIN messages msg ON msg.id = a.message_id
         JOIN conversation_members cm ON cm.conversation_id = msg.conversation_id AND cm.user_id = ?
        WHERE a.media_id = ? LIMIT 1`,
    )
    .get(userId, mediaId);
  return shared ? media : null;
}

router.post(
  '/',
  rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'attachment-upload' }),
  upload.single('file'),
  route(async (req, res) => {
    if (!req.file) return fail(400, 'no_file', 'Choose a file to upload.');
    const extension = ALLOWED_TYPES[req.file.mimetype];
    if (!extension) {
      return fail(415, 'unsupported_type', 'Upload an image, video, PDF, text file or ZIP archive.');
    }
    if (req.file.size === 0) return fail(400, 'empty_file', 'That file is empty.');
    if (req.file.size > MAX_BYTES) return fail(413, 'file_too_large', 'Files must be 10 MB or smaller.');

    const id = randomUUID();
    const filename = `${id}.${extension}`;
    fs.writeFileSync(path.join(uploadsPath, filename), req.file.buffer, { mode: 0o600 });
    db.prepare(
      `INSERT INTO media (id, owner_id, kind, mime, byte_size, storage_path, created_at)
       VALUES (?, ?, 'attachment', ?, ?, ?, ?)`,
    ).run(id, req.user.id, req.file.mimetype, req.file.size, filename, nowIso());

    res.status(201).json({
      attachment: {
        id,
        url: `/api/attachments/${id}`,
        mime: req.file.mimetype,
        byteSize: req.file.size,
        name: path.basename(req.file.originalname || `file.${extension}`).slice(0, 120),
      },
    });
  }),
);

router.get(
  '/:id',
  route(async (req, res) => {
    const media = canReadAttachment(req.params.id, req.user.id);
    if (!media) return fail(404, 'attachment_not_found', 'That file is not available.');
    const absolute = path.join(uploadsPath, media.storage_path);
    if (!fs.existsSync(absolute)) return fail(404, 'attachment_missing', 'That file is no longer stored.');

    const inline = media.mime.startsWith('image/') || media.mime === 'application/pdf' || media.mime.startsWith('video/');
    res.set({
      'Content-Type': media.mime,
      'Content-Length': String(media.byte_size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="chatter-${media.id.slice(0, 8)}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.sendFile(absolute);
  }),
);
