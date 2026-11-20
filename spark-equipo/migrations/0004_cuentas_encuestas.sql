-- Entries made in the app, client records, surveys, sales materials and collection notes.
ALTER TABLE activity ADD COLUMN minutos INTEGER;        -- time the contact took, when the rep says so (otherwise estimated)
ALTER TABLE activity ADD COLUMN botellas_mes INTEGER;   -- rep's estimate of what the account could buy per month

-- Time a rep corrects on a contact that came from the sheet (sheet rows are replaced on every sync, so the correction
-- is kept apart and matched by person, date, account and activity).
CREATE TABLE tiempos (
  persona TEXT NOT NULL, fecha TEXT NOT NULL, clave TEXT NOT NULL, actividad TEXT NOT NULL DEFAULT '', minutos INTEGER NOT NULL,
  PRIMARY KEY (persona, fecha, clave, actividad)
);

-- What people add or correct about an account: contact details, by-the-glass status and pipeline stage.
CREATE TABLE cuentas (
  clave TEXT PRIMARY KEY,           -- normalized account name (calc.js norm)
  nombre TEXT NOT NULL,
  contacto TEXT NOT NULL DEFAULT '', puesto TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', telefono TEXT NOT NULL DEFAULT '',
  ciudad TEXT NOT NULL DEFAULT '', estado TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', notas TEXT NOT NULL DEFAULT '',
  copeo TEXT NOT NULL DEFAULT '',   -- '' unknown | si | propuesto | no
  copeo_vino TEXT NOT NULL DEFAULT '',
  fase TEXT NOT NULL DEFAULT '',    -- overrides the stage from the last CRM entry
  botellas_mes INTEGER,
  actualizado TEXT NOT NULL DEFAULT '', por TEXT NOT NULL DEFAULT ''
);

-- Happy-or-not client surveys. The client answers on a public page reached by the token.
CREATE TABLE encuestas (
  token TEXT PRIMARY KEY,
  cliente TEXT NOT NULL, clave TEXT NOT NULL, persona TEXT NOT NULL,
  creada TEXT NOT NULL,
  respuesta TEXT NOT NULL DEFAULT '',   -- '' pending | feliz | no
  comentario TEXT NOT NULL DEFAULT '',
  respondida TEXT NOT NULL DEFAULT ''
);
CREATE INDEX encuestas_clave ON encuestas (clave);

-- Sales materials: links to price lists, photos, tasting notes, bottle shots.
CREATE TABLE materiales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria TEXT NOT NULL, titulo TEXT NOT NULL, url TEXT NOT NULL, nota TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
INSERT INTO materiales (categoria, titulo, url, nota, creado, por) VALUES
  ('Presentaciones', 'Brand deck 2025', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Brand-Deck-2025.pdf', 'Presentación de la marca', '2026-11-20', 'Spark'),
  ('Presentaciones', 'Presentación para sommeliers 2026', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Presentacion-Sommeliers-2026.pdf', '', '2026-11-20', 'Spark'),
  ('Notas de cata', 'Fichas técnicas 2025 (español)', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Fichas-Tecnicas-2025-ES.pdf', 'Todas las etiquetas', '2026-11-20', 'Spark'),
  ('Notas de cata', 'Technical sheets 2025 (English)', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Technical-Sheets-2025-EN.pdf', '', '2026-11-20', 'Spark'),
  ('Prensa y premios', 'Kit de prensa (español)', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Kit-de-Prensa-ES.pdf', '', '2026-11-20', 'Spark'),
  ('Prensa y premios', 'Press kit (English)', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Press-Kit-EN.pdf', '', '2026-11-20', 'Spark'),
  ('Prensa y premios', 'Premios (español)', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Premios-ES.pdf', '', '2026-11-20', 'Spark'),
  ('Fotos y logos', 'Fotos de prensa (zip)', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Press-Photos.zip', 'Viñedo, bodega y equipo', '2026-11-20', 'Spark'),
  ('Fotos y logos', 'Logos (zip)', 'https://hola.dosbuhos.com/docs/Dos-Buhos-Logos.zip', '', '2026-11-20', 'Spark');

-- Collection follow-up notes per invoice or client.
CREATE TABLE cobros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, factura TEXT NOT NULL DEFAULT '',
  nota TEXT NOT NULL, promesa TEXT NOT NULL DEFAULT '',   -- date the client promised to pay
  monto REAL, por TEXT NOT NULL, creado TEXT NOT NULL
);
