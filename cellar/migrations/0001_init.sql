-- One table holds every collection the artifact used (lots, tasks, protocols, trials, woqueue, wocache, labcache, settings, audit, vineyard).
CREATE TABLE IF NOT EXISTS docs (
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,          -- JSON
  updated_at INTEGER NOT NULL, -- ms
  PRIMARY KEY (coll, id)
);
