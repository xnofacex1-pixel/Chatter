-- Chatter database schema (Stage 1: accounts, profiles, settings, sessions, media)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  username          TEXT NOT NULL,
  username_lower    TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  email_verified_at TEXT,
  is_owner          INTEGER NOT NULL DEFAULT 0,
  is_banned         INTEGER NOT NULL DEFAULT 0,
  banned_reason     TEXT,
  suspended_until   TEXT,
  title             TEXT,
  status            TEXT NOT NULL DEFAULT 'online',
  last_seen_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  mime         TEXT NOT NULL,
  byte_size    INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_owner ON media (owner_id);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  avatar_media_id TEXT REFERENCES media (id) ON DELETE SET NULL,
  banner_media_id TEXT REFERENCES media (id) ON DELETE SET NULL,
  accent_color   TEXT NOT NULL DEFAULT '#38bdf8',
  banner_color   TEXT NOT NULL DEFAULT '#0f1b30',
  custom_status  TEXT,
  about_me       TEXT,
  pronouns       TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id               TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  theme                 TEXT NOT NULL DEFAULT 'dark',
  accent                TEXT NOT NULL DEFAULT 'cyan',
  reduced_motion        INTEGER NOT NULL DEFAULT 0,
  compact_mode          INTEGER NOT NULL DEFAULT 0,
  text_scale            REAL NOT NULL DEFAULT 1,
  message_display       TEXT NOT NULL DEFAULT 'cozy',
  dm_privacy            TEXT NOT NULL DEFAULT 'everyone',
  friend_request_privacy TEXT NOT NULL DEFAULT 'everyone',
  presence_visibility   TEXT NOT NULL DEFAULT 'everyone',
  read_receipts         INTEGER NOT NULL DEFAULT 1,
  notif_desktop         INTEGER NOT NULL DEFAULT 1,
  notif_sounds          INTEGER NOT NULL DEFAULT 1,
  notif_mentions        INTEGER NOT NULL DEFAULT 1,
  notif_messages        INTEGER NOT NULL DEFAULT 1,
  notif_calls           INTEGER NOT NULL DEFAULT 1,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  metadata    TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
