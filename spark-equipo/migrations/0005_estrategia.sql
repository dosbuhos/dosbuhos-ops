-- Strategy documents and goals for the year, and the promotions that were authorized (what, when, by whom).
-- `visible` = 1 lets the whole team see the row; 0 keeps it to admins.
CREATE TABLE estrategia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'documento',   -- documento | meta
  titulo TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', nota TEXT NOT NULL DEFAULT '',
  anio INTEGER, visible INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
CREATE TABLE promociones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, detalle TEXT NOT NULL DEFAULT '', aplica TEXT NOT NULL DEFAULT '',   -- which clients or channel
  inicio TEXT NOT NULL DEFAULT '', fin TEXT NOT NULL DEFAULT '',
  autorizo TEXT NOT NULL DEFAULT '', autorizada TEXT NOT NULL DEFAULT '',                   -- who approved it and on what date
  visible INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
