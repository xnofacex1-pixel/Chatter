import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, uploadsPath } from '../db.js';
import { fail, route } from '../lib/http.js';
import { requireUser } from './me.js';

export const router = Router();

/**
 * Media is only served to signed-in members. Attachments added in later stages
 * will add per-record access checks on top of this authentication gate.
 */
router.get(
  '/:id',
  requireUser,
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!row) return fail(404, 'not_found', 'That file could not be found.');
    const filePath = path.join(uploadsPath, row.storage_path);
    if (!filePath.startsWith(uploadsPath) || !fs.existsSync(filePath)) {
      return fail(404, 'not_found', 'That file could not be found.');
    }
    res.set({
      'Content-Type': row.mime,
      'Content-Length': String(row.byte_size),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${row.kind}-${row.id}"`,
    });
    fs.createReadStream(filePath).pipe(res);
  }),
);
