-- ===========================================================================
-- Yaar — database schema (PostgreSQL: Supabase in production, PGlite locally)
--
-- Applied automatically on server start (every statement is idempotent). You
-- can also paste it into the Supabase SQL editor to create the tables up front.
--
-- Design notes
--  * `users.id` is either an anonymous device/session id, or `sb_<uuid>` for a
--    Supabase-authenticated account (`auth_provider = 'supabase'`,
--    `auth_subject` = the Supabase user id taken from the VERIFIED JWT).
--  * `usage_limits` is the server-side source of truth for the 20 messages /
--    24 hours rule. One row per user.
--  * Times are BIGINT epoch milliseconds — the server clock is authoritative.
--  * Row Level Security is ENABLED with NO policies: the tables are invisible
--    to Supabase's public Data API (anon / publishable key). Only the server,
--    connecting through DATABASE_URL as the database owner, can read them.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  display_name      TEXT,
  auth_provider     TEXT NOT NULL DEFAULT 'anonymous',
  auth_subject      TEXT,
  email             TEXT,
  created_at        BIGINT NOT NULL,
  last_seen_at      BIGINT NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users (last_seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_subject
  ON users (auth_provider, auth_subject) WHERE auth_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  companion_id    TEXT NOT NULL,
  title           TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  last_message_at BIGINT,
  is_archived     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_companion
  ON conversations (user_id, companion_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sender          TEXT NOT NULL CHECK (sender IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent',
  error_code      TEXT,
  model           TEXT,
  provider        TEXT,
  created_at      BIGINT NOT NULL,
  seq             INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_seq
  ON messages (conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_user_created
  ON messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_limits (
  user_id            TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  window_started_at  BIGINT NOT NULL,
  window_expires_at  BIGINT NOT NULL,
  messages_used      INTEGER NOT NULL DEFAULT 0,
  lifetime_messages  INTEGER NOT NULL DEFAULT 0,
  updated_at         BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_limits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_meta   ENABLE ROW LEVEL SECURITY;
