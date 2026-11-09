-- Horizonte: every record (task, board, setting) is one row; fields merge one by one, latest edit wins.
CREATE TABLE IF NOT EXISTS rec (
  kind TEXT NOT NULL,          -- 'task' | 'board' | 'pref'
  id   TEXT NOT NULL,
  data TEXT NOT NULL,          -- JSON of the record's fields
  vers TEXT NOT NULL,          -- JSON: field -> logical clock of its last write
  seq  INTEGER NOT NULL,       -- change counter; devices pull rows with seq above their cursor
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS rec_seq ON rec (seq);
CREATE TABLE IF NOT EXISTS counter (name TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO counter (name, v) VALUES ('seq', 0);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT
);
