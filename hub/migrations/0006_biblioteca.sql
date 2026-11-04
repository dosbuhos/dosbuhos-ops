-- Biblioteca: the Dos Búhos document library inside the Hub (/biblioteca/). Policies, contracts, SOPs, forms, proposals…
-- Every document has numbered versions; every version can carry several files (e.g. the PDF to send + the Word to edit).
-- Files live in D1 as chunks (lib_chunks) so both the page and Claude (through the D1 API) can file documents.

CREATE TABLE IF NOT EXISTS lib_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'otros',   -- see CATEGORIES in src/biblioteca.js
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'vigente' CHECK (status IN ('borrador', 'vigente', 'archivado')),
  audience TEXT NOT NULL DEFAULT '',         -- who it applies to / who it is for
  tags TEXT NOT NULL DEFAULT '',             -- comma-separated
  link TEXT NOT NULL DEFAULT '',             -- optional: Claude artifact, Google Doc, etc.
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lib_docs_cat ON lib_docs(category, updated_at);

CREATE TABLE IF NOT EXISTS lib_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES lib_docs(id) ON DELETE CASCADE,
  version TEXT NOT NULL,                     -- "1.0", "1.1", "2.0"
  note TEXT NOT NULL DEFAULT '',             -- what changed
  created_by TEXT NOT NULL DEFAULT '',       -- Hub email, or "claude"
  created_at INTEGER NOT NULL,
  UNIQUE (doc_id, version)
);

CREATE TABLE IF NOT EXISTS lib_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES lib_versions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 0,         -- complete when every chunk 0..chunks-1 is present
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lib_chunks (
  file_id INTEGER NOT NULL REFERENCES lib_files(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (file_id, idx)
);

INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, sort)
VALUES ('biblioteca', 'Biblioteca', 'admin', 'Políticas, contratos, procedimientos y formatos, con versiones', 'live', 'internal', '/biblioteca/', 5);
