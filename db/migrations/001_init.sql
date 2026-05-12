-- Users
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','superuser')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Editable copy
CREATE TABLE IF NOT EXISTS content (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','markdown','html','image')),
  page        TEXT,
  section     TEXT,
  label       TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_content_page ON content(page, section, sort_order);

-- Revisions for undo / audit
CREATE TABLE IF NOT EXISTS content_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_content_revisions_key ON content_revisions(key, updated_at DESC);

-- Uploaded media metadata
CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL UNIQUE,
  original    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  byte_size   INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Tracks the most recent build for the dashboard
CREATE TABLE IF NOT EXISTS builds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ok','error')),
  log         TEXT NOT NULL DEFAULT '',
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
