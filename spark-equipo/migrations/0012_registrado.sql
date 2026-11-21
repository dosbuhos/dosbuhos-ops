-- When each contact was logged, to measure the 48-hour rule. App entries are stamped on insert; sheet rows get the date
-- the sync first saw them (kept in `vistos`, because the sheet copy is replaced on every sync).
ALTER TABLE activity ADD COLUMN registrado TEXT NOT NULL DEFAULT '';
CREATE TABLE vistos (
  clave TEXT PRIMARY KEY,
  visto TEXT NOT NULL
);
