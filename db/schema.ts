export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    access_count INTEGER NOT NULL DEFAULT 0,
    last_access_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS report_presentations (
    report_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'text',
    html_object_key TEXT,
    html_filename TEXT,
    html_size INTEGER,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS access_codes (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS access_codes_report_idx ON access_codes(report_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    session_type TEXT NOT NULL,
    report_id TEXT,
    admin_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS attachments_report_idx ON attachments(report_id)`,
  `CREATE TABLE IF NOT EXISTS access_events (
    id TEXT PRIMARY KEY,
    report_id TEXT,
    event_type TEXT NOT NULL,
    success INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS access_events_report_idx ON access_events(report_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    limiter_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    window_started_at TEXT NOT NULL,
    blocked_until TEXT
  )`,
];
