import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const uploadsDir = path.join(dataDir, 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const dbFile = process.env.DATABASE_FILE || path.join(dataDir, 'chatter.db');

export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
db.exec(schema);

export const uploadsPath = uploadsDir;

/** Run a set of statements inside a single transaction. */
export function transaction(fn) {
  return db.transaction(fn)();
}

export const nowIso = () => new Date().toISOString();

export function addSeconds(seconds, from = new Date()) {
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

export function addMinutes(minutes, from = new Date()) {
  return addSeconds(minutes * 60, from);
}

export function addDays(days, from = new Date()) {
  return addSeconds(days * 86400, from);
}
