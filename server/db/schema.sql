-- ===========================================================================
-- Yaar — database schema (SQLite)
--
-- Design notes
--  * `users` rows are anonymous sessions today. The `auth_provider` /
--    `auth_subject` columns are already in place so that real authentication
--    (Google / phone / email) can be added later without a migration of the
--    other tables: only `users` gains values.
--  * `usage_limits` is the server-side source of truth for the 20 messages /
--    24 hours rule. One row per user. Counters are only written after a user
--    message has been accepted, and the window rolls forward automatically
--    once `window_expires_at` has passed.
--  * Times are stored as `INTEGER` epoch milliseconds — the server clock is
--    authoritative, client clocks are never trusted.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,             -- opaque session/device id
  display_name      TEXT,                         -- optional, user supplied
  auth_provider     TEXT NOT NULL DEFAULT 'anonymous',
  auth_subject      TEXT,                         -- reserved for real auth later
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at);

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  companion_id  TEXT NOT NULL,                    -- 'girlfriend' | 'boyfriend'
  title         TEXT,                             -- optional label for the UI
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_message_at INTEGER,
  is_archived   INTEGER NOT NULL DEFAULT 0
);

-- One active conversation per user + companion.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_companion
  ON conversations (user_id, companion_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sender          TEXT NOT NULL CHECK (sender IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent',   -- sent | streaming | failed
  error_code      TEXT,
  model           TEXT,                            -- which model produced an AI reply
  provider        TEXT,
  created_at      INTEGER NOT NULL,
  seq             INTEGER NOT NULL                 -- monotonic per conversation
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
  ON messages (conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_user_created
  ON messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_limits (
  user_id            TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  window_started_at  INTEGER NOT NULL,             -- when the current window began
  window_expires_at  INTEGER NOT NULL,             -- when it rolls over
  messages_used      INTEGER NOT NULL DEFAULT 0,    -- SUCCESSFUL user messages only
  lifetime_messages  INTEGER NOT NULL DEFAULT 0,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
