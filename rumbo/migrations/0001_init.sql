-- Rumbo: the F&B director's initiatives, check-ins, wins and comments.
CREATE TABLE IF NOT EXISTS iniciativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'restaurante',     -- restaurante | enoturismo | eventos | club | alianzas | costos | controles | equipo
  tipo TEXT NOT NULL DEFAULT 'ingreso',         -- ingreso | ahorro | base
  origen TEXT NOT NULL DEFAULT 'propia',        -- propia | biblioteca | sugerida | precargada
  clave TEXT NOT NULL DEFAULT '',               -- library card it was adopted from
  porque TEXT NOT NULL DEFAULT '',
  etapa TEXT NOT NULL DEFAULT 'idea' CHECK (etapa IN ('idea','planeacion','marcha','resultado','pausada','cerrada')),
  siguiente TEXT NOT NULL DEFAULT '',           -- one concrete next step
  siguiente_fecha TEXT NOT NULL DEFAULT '',     -- YYYY-MM-DD
  revisar INTEGER NOT NULL DEFAULT 0,           -- 1 = pre-loaded placeholder the director still has to confirm
  creado TEXT NOT NULL,
  por TEXT NOT NULL DEFAULT '',
  actualizado TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS medidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iniciativa_id INTEGER NOT NULL REFERENCES iniciativas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  unidad TEXT NOT NULL DEFAULT '',              -- '$', '%', 'altas', ...
  meta REAL,                                    -- target per period; NULL = tracked without a target
  periodo TEXT NOT NULL DEFAULT 'mes' CHECK (periodo IN ('semana','mes')),
  modo TEXT NOT NULL DEFAULT 'suma' CHECK (modo IN ('suma','ultimo')),   -- add check-ins up, or take the latest value (percentages)
  sentido TEXT NOT NULL DEFAULT 'sube' CHECK (sentido IN ('sube','baja')),
  auto TEXT NOT NULL DEFAULT ''                 -- '' = typed at check-in; 'club_altas' | 'club_neto' = read from the wine club database
);
CREATE INDEX IF NOT EXISTS medidas_ini ON medidas(iniciativa_id);
CREATE TABLE IF NOT EXISTS pasos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iniciativa_id INTEGER NOT NULL REFERENCES iniciativas(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  hecho INTEGER NOT NULL DEFAULT 0,
  hecho_fecha TEXT NOT NULL DEFAULT '',
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pasos_ini ON pasos(iniciativa_id);
CREATE TABLE IF NOT EXISTS registros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iniciativa_id INTEGER NOT NULL REFERENCES iniciativas(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,                          -- YYYY-MM-DD the check-in is about
  nota TEXT NOT NULL DEFAULT '',
  valores TEXT NOT NULL DEFAULT '{}',           -- { "<medida id>": number }
  por TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS registros_ini ON registros(iniciativa_id, fecha);
CREATE TABLE IF NOT EXISTS archivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, mime TEXT NOT NULL, datos BLOB NOT NULL, bytes INTEGER NOT NULL,
  creado TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS logros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT 'restaurante',
  iniciativa_id INTEGER REFERENCES iniciativas(id) ON DELETE SET NULL,
  fecha TEXT NOT NULL,
  etapa TEXT NOT NULL DEFAULT 'marcha' CHECK (etapa IN ('propuesta','marcha','resultado')),
  url TEXT NOT NULL DEFAULT '',
  archivo_id INTEGER REFERENCES archivos(id) ON DELETE SET NULL,
  revisar INTEGER NOT NULL DEFAULT 0,
  por TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logros_fecha ON logros(fecha);
CREATE TABLE IF NOT EXISTS comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('iniciativa','logro')),
  ref_id INTEGER NOT NULL,
  texto TEXT NOT NULL,
  por TEXT NOT NULL DEFAULT '', nombre TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comentarios_ref ON comentarios(tipo, ref_id);
