-- Original documents attached to a promotion (the letter or plan as it was sent out), kept in D1 so they stay behind sign-in
-- and out of the public repo. `resumen` is the one-line version of the offer; `detalle` keeps the full terms.
CREATE TABLE archivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, mime TEXT NOT NULL, datos BLOB NOT NULL, bytes INTEGER NOT NULL,
  creado TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
ALTER TABLE promociones ADD COLUMN resumen TEXT NOT NULL DEFAULT '';
ALTER TABLE promociones ADD COLUMN archivo_id INTEGER;
ALTER TABLE promociones ADD COLUMN archivo_nombre TEXT NOT NULL DEFAULT '';
