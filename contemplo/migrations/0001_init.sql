-- Contemplo Studio: video library, paired Android TV players, what each player should hold, and the commands sent to it.

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,                 -- random id, also the R2 key stem: videos/<id>.mp4
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,     -- bytes
  duration_ms INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',     -- hex, computed in the browser while uploading; the TV checks its copy against it
  tags TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  has_thumb INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
  upload_id TEXT NOT NULL DEFAULT '',  -- R2 multipart upload id while uploading
  part_size INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_created ON videos(created_at);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,            -- SHA-256 of the device's bearer token; the token itself lives only on the TV
  show_pin TEXT NOT NULL DEFAULT '',   -- PIN for the local (Wi-Fi) show control page served by the TV
  model TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  lan_ip TEXT NOT NULL DEFAULT '',
  lan_port INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT '{}',    -- last state reported by the TV (JSON): program, cue, blackout, position…
  storage TEXT NOT NULL DEFAULT '{}',  -- {total, free, used} bytes
  last_error TEXT NOT NULL DEFAULT '',
  last_seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- A six-digit code shown on the TV until someone enters it in the dashboard.
CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,           -- the TV polls with the secret; only its hash is kept
  model TEXT NOT NULL DEFAULT '',
  device_id TEXT,                      -- set when paired
  token TEXT,                          -- handed to the TV once, then cleared
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- What each device should hold locally, and how far it has got.
CREATE TABLE IF NOT EXISTS device_media (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'downloading', 'verifying', 'ready', 'failed')),
  progress REAL NOT NULL DEFAULT 0,    -- 0..1
  error TEXT NOT NULL DEFAULT '',
  requested_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, video_id)
);

-- Commands sent from the dashboard over the internet. Status only moves to done/failed when the TV says so.
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'done', 'failed', 'expired')),
  result TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  acked_at INTEGER
);
CREATE INDEX IF NOT EXISTS commands_device ON commands(device_id, status, created_at);

-- Run-of-show lists (show mode: cue by cue) and ambient playlists (loop the whole list).
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'show' CHECK (mode IN ('show', 'ambient')),
  loop INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  transition TEXT NOT NULL DEFAULT 'cut' CHECK (transition IN ('cut', 'fade')),
  fade_ms INTEGER NOT NULL DEFAULT 1000,
  end_action TEXT NOT NULL DEFAULT 'loop' CHECK (end_action IN ('loop', 'hold', 'black', 'next')),
  PRIMARY KEY (playlist_id, pos)
);

-- What happened, per device (pairing, sync results, errors, commands) — the diagnostics panel reads it.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_at ON events(device_id, at);
