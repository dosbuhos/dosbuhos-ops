-- One-time import tokens (Timestripe import). A row lets the browser tab holding the data post it once; delete after use.
CREATE TABLE IF NOT EXISTS import_tokens (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
