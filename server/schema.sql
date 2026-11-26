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

-- ---------------------------------------------------------------------------
-- Stage 2: friends, direct conversations, groups and realtime messaging
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS friendships (
  user_a_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships (user_b_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id           TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TEXT NOT NULL,
  responded_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending
  ON friend_requests (from_user_id, to_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests (to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests (from_user_id, status);

CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  dm_key        TEXT UNIQUE,
  title         TEXT,
  icon_media_id TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_message_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_last ON conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       TEXT NOT NULL,
  last_read_at    TEXT,
  muted           INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL DEFAULT '',
  reply_to_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  edited_at       TEXT,
  deleted_at      TEXT,
  pinned_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages (author_id);

CREATE TABLE IF NOT EXISTS message_attachments (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments (message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_media ON message_attachments (media_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
