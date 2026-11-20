-- Web push: VAPID keys (generated once, kept in meta), one row per subscribed device, and a dedupe log of what was sent.
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (
  id TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  label TEXT,
  digest INTEGER NOT NULL DEFAULT 1,
  alerts INTEGER NOT NULL DEFAULT 1,
  created INTEGER NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
