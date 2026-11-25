-- Arqueo — physical inventory of Almacén 1, reconciled against Zoho.
-- One invariant: the balance of a SKU is the sum of its movimientos. A count never patches a balance;
-- it writes an ajuste_conteo movement for the difference, so the ledger always explains the number.

-- SKUs mirrored from Zoho (read-only copy, refreshed by the sync).
CREATE TABLE IF NOT EXISTS sku (
  item_id       TEXT PRIMARY KEY,                  -- Zoho item_id
  sku           TEXT NOT NULL DEFAULT '',
  nombre        TEXT NOT NULL,
  activo        INTEGER NOT NULL DEFAULT 1,
  botellas_caja INTEGER NOT NULL DEFAULT 12,       -- editable per SKU (375 ml and others differ)
  cajas_tarima  INTEGER NOT NULL DEFAULT 0,        -- 0 = no standard pallet for this SKU
  posicion_id   INTEGER REFERENCES posicion(id),   -- where it normally sits
  zoho_stock    REAL,                              -- Almacén 1 stock at the last sync
  zoho_at       TEXT,
  contado_at    TEXT                               -- last time it was counted (drives the rotación queue)
);

-- The position layer Zoho does not have (storage locations are off org-wide).
CREATE TABLE IF NOT EXISTS posicion (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,                     -- A-01, PASILLO B, TARIMA 3
  zona   TEXT NOT NULL DEFAULT '',
  nota   TEXT NOT NULL DEFAULT '',
  activa INTEGER NOT NULL DEFAULT 1,
  orden  INTEGER NOT NULL DEFAULT 0
);

-- A count session: the baseline, a surtido, a rotation count or a spot audit.
CREATE TABLE IF NOT EXISTS conteo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo       TEXT NOT NULL CHECK (tipo IN ('base', 'surtido', 'rotacion', 'auditoria')),
  ov         TEXT NOT NULL DEFAULT '',             -- OV-02519
  ov_id      TEXT NOT NULL DEFAULT '',             -- Zoho salesorder_id
  cliente    TEXT NOT NULL DEFAULT '',
  estado     TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado', 'cancelado')),
  parcial    INTEGER NOT NULL DEFAULT 0,           -- 1 = the OV could not be filled in full
  usuario    TEXT NOT NULL,
  abierto_at TEXT NOT NULL,
  cerrado_at TEXT
);
CREATE INDEX IF NOT EXISTS conteo_ov ON conteo (ov_id);
CREATE INDEX IF NOT EXISTS conteo_estado ON conteo (estado, tipo);

-- One SKU inside a session: what was pulled, what was counted, and the difference.
CREATE TABLE IF NOT EXISTS conteo_linea (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  conteo_id    INTEGER NOT NULL REFERENCES conteo(id),
  item_id      TEXT NOT NULL REFERENCES sku(item_id),
  surtido      INTEGER NOT NULL DEFAULT 0,         -- bottles that left for the OV
  pedido       INTEGER NOT NULL DEFAULT 0,         -- bottles the OV asked for
  tarimas      INTEGER NOT NULL DEFAULT 0,
  cajas        INTEGER NOT NULL DEFAULT 0,
  sueltas      INTEGER NOT NULL DEFAULT 0,
  contado      INTEGER NOT NULL,                   -- what the counter found, after the pull
  esperado     INTEGER NOT NULL,                   -- the ledger's balance after the pull, hidden until submit
  variacion    INTEGER NOT NULL,                   -- contado - esperado
  motivo       TEXT NOT NULL DEFAULT '',
  foto         TEXT NOT NULL DEFAULT '',           -- R2 key
  nota         TEXT NOT NULL DEFAULT '',
  revisado_por TEXT NOT NULL DEFAULT '',
  revisado_at  TEXT
);
CREATE INDEX IF NOT EXISTS linea_conteo ON conteo_linea (conteo_id);
CREATE INDEX IF NOT EXISTS linea_item ON conteo_linea (item_id);

-- Every bottle in or out. Append-only: a correction is a new row, never an edit.
CREATE TABLE IF NOT EXISTS movimiento (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha     TEXT NOT NULL,                         -- YYYY-MM-DD, the day it happened
  tipo      TEXT NOT NULL CHECK (tipo IN ('base', 'salida_ov', 'traspaso', 'entrada', 'devolucion', 'merma', 'muestra', 'ajuste_conteo')),
  item_id   TEXT NOT NULL REFERENCES sku(item_id),
  botellas  INTEGER NOT NULL,                      -- signed: out is negative
  ov        TEXT NOT NULL DEFAULT '',
  destino   TEXT NOT NULL DEFAULT '',              -- traspaso: Barra, Restaurante, Almacén 2, Tienda, Bodega CDMX, Evento
  motivo    TEXT NOT NULL DEFAULT '',
  nota      TEXT NOT NULL DEFAULT '',
  foto      TEXT NOT NULL DEFAULT '',
  conteo_id INTEGER REFERENCES conteo(id),
  usuario   TEXT NOT NULL,
  creado_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mov_item ON movimiento (item_id);
CREATE INDEX IF NOT EXISTS mov_fecha ON movimiento (fecha DESC);

-- The balance, always derived. Never written to.
CREATE VIEW IF NOT EXISTS saldo AS
  SELECT item_id, SUM(botellas) AS botellas, MAX(creado_at) AS ultimo_at FROM movimiento GROUP BY item_id;

-- Nightly copy of what Zoho says about Almacén 1, so the conciliación compares like with like.
CREATE TABLE IF NOT EXISTS zoho_snapshot (
  fecha      TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  stock      REAL NOT NULL DEFAULT 0,
  disponible REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (fecha, item_id)
);

-- The correction list administración keys into Zoho. The app writes nothing to Zoho itself.
CREATE TABLE IF NOT EXISTS ajuste (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  creado_at    TEXT NOT NULL,
  item_id      TEXT NOT NULL REFERENCES sku(item_id),
  botellas     INTEGER NOT NULL,                   -- signed difference Zoho has to move
  arqueo       INTEGER NOT NULL,                   -- the app's balance when the line was generated
  zoho         INTEGER NOT NULL,                   -- Zoho's stock then
  descripcion  TEXT NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aplicado', 'verificado', 'reabierto')),
  aplicado_por TEXT NOT NULL DEFAULT '',
  aplicado_at  TEXT,
  verificado_at TEXT
);
CREATE INDEX IF NOT EXISTS ajuste_estado ON ajuste (estado);

-- Open OVs that hold committed stock although a factura already exists for them: the phantom-commitment cleanup list.
CREATE TABLE IF NOT EXISTS fantasma (
  ov       TEXT PRIMARY KEY,
  ov_id    TEXT NOT NULL DEFAULT '',
  cliente  TEXT NOT NULL DEFAULT '',
  fecha    TEXT NOT NULL DEFAULT '',
  botellas INTEGER NOT NULL DEFAULT 0,
  factura  TEXT NOT NULL DEFAULT '',
  dias     INTEGER NOT NULL DEFAULT 0,
  visto_at TEXT NOT NULL,
  estado   TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada'))
);

-- Settings that are not worth a deploy to change (baseline done, tolerances, rotation days).
CREATE TABLE IF NOT EXISTS ajustes_app (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
INSERT OR IGNORE INTO ajustes_app (clave, valor) VALUES
  ('base_cerrada', '0'),       -- 1 once the wall-to-wall baseline count is closed
  ('tol_ambar', '1'),          -- variance from here: reason required
  ('tol_rojo', '6'),           -- variance from here: reason + photo, supervisor notified
  ('tol_pct', '2'),            -- or this % of the SKU's balance, whichever is smaller
  ('dias_rotacion', '45'),     -- a SKU uncounted this long enters the queue
  ('dias_rotacion_top', '30'); -- the ten largest SKUs, sooner
