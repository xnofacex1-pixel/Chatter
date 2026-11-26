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

CREATE TABLE IF NOT EXISTS message_polls (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  multiple   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_poll_options (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_poll_options_message ON message_poll_options (message_id, position);

CREATE TABLE IF NOT EXISTS message_poll_votes (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL REFERENCES message_poll_options(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (option_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_message ON message_poll_votes (message_id, user_id);

-- ---------------------------------------------------------------------------
-- Stage 3: servers (communities), roles, permissions, channels, invites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS servers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon_media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  banner_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  is_public       INTEGER NOT NULL DEFAULT 1,
  is_suspended    INTEGER NOT NULL DEFAULT 0,
  suspend_reason  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers (owner_id);
CREATE INDEX IF NOT EXISTS idx_servers_public ON servers (is_public, is_suspended);

CREATE TABLE IF NOT EXISTS server_settings (
  server_id                  TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  welcome_message            TEXT,
  default_notification_level TEXT NOT NULL DEFAULT 'all',
  verification_level         TEXT NOT NULL DEFAULT 'none'
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT,
  joined_at     TEXT NOT NULL,
  timeout_until TEXT,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members (user_id);
CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members (server_id, joined_at);

CREATE TABLE IF NOT EXISTS server_roles (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#8b9bb4',
  permissions INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_roles_server ON server_roles (server_id, position DESC);

CREATE TABLE IF NOT EXISTS server_member_roles (
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     TEXT NOT NULL REFERENCES server_roles(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_server_member_roles_role ON server_member_roles (role_id);

CREATE TABLE IF NOT EXISTS server_categories (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_categories ON server_categories (server_id, position);

CREATE TABLE IF NOT EXISTS server_channels (
  id              TEXT PRIMARY KEY,
  server_id       TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  category_id     TEXT REFERENCES server_categories(id) ON DELETE SET NULL,
  conversation_id TEXT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'text',
  topic           TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  is_private      INTEGER NOT NULL DEFAULT 0,
  read_only       INTEGER NOT NULL DEFAULT 0,
  slowmode_seconds INTEGER NOT NULL DEFAULT 0,
  user_limit      INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_channels_server ON server_channels (server_id, position);

CREATE TABLE IF NOT EXISTS server_channel_overwrites (
  channel_id  TEXT NOT NULL REFERENCES server_channels(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  allow       INTEGER NOT NULL DEFAULT 0,
  deny        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS channel_reads (
  channel_id   TEXT NOT NULL REFERENCES server_channels(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS server_invites (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES server_channels(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  max_uses   INTEGER NOT NULL DEFAULT 0,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_server_invites_server ON server_invites (server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS server_bans (
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason     TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS server_moderation (
  id             TEXT PRIMARY KEY,
  server_id      TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  reason         TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_moderation ON server_moderation (server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS server_notification_prefs (
  server_id    TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level        TEXT NOT NULL DEFAULT 'all',
  muted_until  TEXT,
  PRIMARY KEY (server_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Stage 4: calls (signalling metadata; media flows peer-to-peer over WebRTC)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calls (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id      TEXT REFERENCES server_channels(id) ON DELETE CASCADE,
  server_id       TEXT REFERENCES servers(id) ON DELETE CASCADE,
  started_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'ringing',
  created_at      TEXT NOT NULL,
  ended_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_active ON calls (status, created_at DESC);

CREATE TABLE IF NOT EXISTS call_participants (
  call_id     TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state       TEXT NOT NULL DEFAULT 'invited',
  mic_muted   INTEGER NOT NULL DEFAULT 0,
  deafened    INTEGER NOT NULL DEFAULT 0,
  video_on    INTEGER NOT NULL DEFAULT 0,
  screen_on   INTEGER NOT NULL DEFAULT 0,
  invited_at  TEXT NOT NULL,
  joined_at   TEXT,
  left_at     TEXT,
  PRIMARY KEY (call_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants (user_id);

-- ---------------------------------------------------------------------------
-- Stage 5 and 6: platform moderation, staff, settings, notifications, reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_moderation (
  id             TEXT PRIMARY KEY,
  actor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  reason         TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_moderation_target ON platform_moderation (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_assignments (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  permissions TEXT,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_user ON staff_assignments (user_id, revoked_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  link            TEXT,
  actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  server_id       TEXT REFERENCES servers(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      TEXT REFERENCES messages(id) ON DELETE CASCADE,
  read_at         TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, read_at);

CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  reporter_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  reported_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  server_id       TEXT REFERENCES servers(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  details         TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Stage 8: Chatter AI (Groq). Conversations are private to their owner.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New chat',
  model      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  model           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages (conversation_id, created_at);
