CREATE TABLE IF NOT EXISTS report_presentations (
  report_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'text',
  html_object_key TEXT,
  html_filename TEXT,
  html_size INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
