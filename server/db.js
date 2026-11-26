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

/**
 * Additive migrations for databases created by earlier stages. schema.sql only
 * uses CREATE TABLE IF NOT EXISTS, so new columns on existing tables need an
 * explicit guarded ALTER TABLE.
 */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table.replace(/[^a-z_]/gi, '')})`).all();
  if (columns.length === 0) return;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Stage 3: text channels reuse the Stage 2 message pipeline via a conversation.
ensureColumn('conversations', 'channel_id', 'TEXT');
ensureColumn('users', 'suspended_reason', 'TEXT');
ensureColumn('users', 'suspended_by', 'TEXT');

// Stage 6: voice/video device preferences and extra notification toggles.
ensureColumn('user_settings', 'voice_input_volume', 'REAL NOT NULL DEFAULT 1');
ensureColumn('user_settings', 'voice_output_volume', 'REAL NOT NULL DEFAULT 1');
ensureColumn('user_settings', 'mic_device', 'TEXT');
ensureColumn('user_settings', 'speaker_device', 'TEXT');
ensureColumn('user_settings', 'camera_device', 'TEXT');
ensureColumn('user_settings', 'notif_reactions', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('user_settings', 'notif_announcements', 'INTEGER NOT NULL DEFAULT 1');

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
