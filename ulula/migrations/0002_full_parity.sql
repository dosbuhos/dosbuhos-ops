-- Ulula 0.2 · paridad completa con GrapeFlow: Panel, Viñedo, Vendimia, Embotellado, Inventario, Configuración

-- ---------- configuración
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Dos Búhos',
  appearance TEXT NOT NULL DEFAULT 'system',        -- light | dark | system
  profile TEXT NOT NULL DEFAULT 'full',              -- full | vineyard | winery
  sugar_unit TEXT NOT NULL DEFAULT 'brix',           -- baume | brix | density
  production_mode TEXT,                              -- organic | integrated | conventional | mixed
  address TEXT, city TEXT, region TEXT, postal_code TEXT,
  tax_id TEXT, phone TEXT, email TEXT,
  vineyard_ha REAL,
  lot_numbering TEXT NOT NULL DEFAULT 'standard',    -- standard | custom
  lot_pattern TEXT,
  advanced_modules INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO company (id, name, production_mode) VALUES (1, 'Dos Búhos', 'organic');

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN area TEXT NOT NULL DEFAULT 'company';   -- company | vineyard | winery | both
ALTER TABLE users ADD COLUMN last_seen TEXT;
UPDATE users SET role = 'operator' WHERE role = 'crew';

ALTER TABLE locations ADD COLUMN kind TEXT NOT NULL DEFAULT 'room';   -- building | room | row | shelf
ALTER TABLE locations ADD COLUMN parent_id INTEGER REFERENCES locations(id);

ALTER TABLE vessels ADD COLUMN grain TEXT;                              -- fine | medium | coarse
ALTER TABLE vessels ADD COLUMN barrel_status TEXT;                      -- available | full | empty | cleaning | maintenance | inactive
ALTER TABLE vessels ADD COLUMN barrel_notes TEXT;

CREATE TABLE IF NOT EXISTS vessel_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vessel_id INTEGER NOT NULL REFERENCES vessels(id),
  noted_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',                 -- note | maintenance | fill
  text TEXT,
  by_name TEXT
);

-- ---------- viñedo
CREATE TABLE IF NOT EXISTS parcels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  vineyard TEXT NOT NULL,
  variety TEXT NOT NULL,
  area_ha REAL NOT NULL,
  planted_year INTEGER,
  wine_type TEXT,
  appellation TEXT,
  locality TEXT,
  target_wine TEXT, soil TEXT, orientation TEXT, spacing TEXT, rootstock TEXT, clone TEXT,
  irrigation TEXT,                                   -- irrigated | dry
  production_mode TEXT,                              -- organic | integrated | biodynamic | sustainable | conventional | conversion
  vines INTEGER, expected_yield_t_ha REAL, irrigation_method TEXT, ec REAL,
  geojson TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phenology (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_id INTEGER NOT NULL REFERENCES parcels(id),
  observed_at TEXT NOT NULL,
  season INTEGER NOT NULL,
  stage TEXT NOT NULL,                               -- A … N (Baggiolini)
  operator_name TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS field_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  parcel_ids TEXT NOT NULL,                          -- JSON array
  equipment TEXT,
  crew TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spray_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_type TEXT NOT NULL DEFAULT 'pesticide',      -- pesticide | fertilizer | soil_amendment | biological | other
  name TEXT NOT NULL,
  registration_no TEXT,
  active_ingredient TEXT,
  rei_hours REAL,
  phi_days REAL,
  default_rate REAL,
  unit TEXT,                                         -- l/ha | ml/ha | kg/ha | g/ha
  is_active INTEGER NOT NULL DEFAULT 1,
  manufacturer TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS spray_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  applicator TEXT NOT NULL,
  applicator_cert TEXT,
  equipment TEXT,
  method TEXT NOT NULL DEFAULT 'ground',             -- ground | air | other
  wind_kmh REAL, wind_dir TEXT, temp_c REAL,
  blocks TEXT NOT NULL,                              -- JSON [{parcel_id, area_ha}]
  products TEXT NOT NULL,                            -- JSON [{input_id, input_type, name, registration_no, active_ingredient, target, rate, unit, total, rei_hours, phi_days, notes}]
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  correction_reason TEXT,
  history TEXT,                                      -- JSON of previous versions (never deleted)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maturation_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcel_id INTEGER NOT NULL REFERENCES parcels(id),
  sampled_at TEXT NOT NULL,
  season INTEGER NOT NULL,
  brix REAL, ph REAL, ta REAL, potential_alc REAL, temp REAL, gluconic REAL,
  berry_weight_100 REAL,
  ammonium REAL, alpha_amino REAL,
  operator_name TEXT,
  notes TEXT
);

-- ---------- vendimia
CREATE TABLE IF NOT EXISTS harvest_receptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  season INTEGER NOT NULL,
  origin TEXT NOT NULL DEFAULT 'own',                -- own | purchased
  parcel_id INTEGER REFERENCES parcels(id),
  parcel_label TEXT,
  variety TEXT NOT NULL,
  wine_type TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  brix REAL, ph REAL, ta REAL, temp REAL,
  reception_notes TEXT,
  process TEXT NOT NULL DEFAULT 'maceration',        -- direct_press | maceration
  lot_code TEXT,
  lot_id INTEGER REFERENCES lots(id),
  destinations TEXT NOT NULL,                        -- JSON [{vessel_id, kg}]
  operator_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE lots ADD COLUMN parcel_id INTEGER REFERENCES parcels(id);
ALTER TABLE lots ADD COLUMN reception_id INTEGER REFERENCES harvest_receptions(id);

CREATE TABLE IF NOT EXISTS ferment_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  vessel_id INTEGER REFERENCES vessels(id),
  read_at TEXT NOT NULL,
  sugar REAL NOT NULL,
  sugar_unit TEXT NOT NULL DEFAULT 'brix',
  temp REAL,
  recorded_by TEXT NOT NULL,
  shift TEXT,                                        -- morning | afternoon | other
  notes TEXT
);
CREATE INDEX IF NOT EXISTS ferment_lot ON ferment_readings(lot_id, read_at);

-- ---------- inventario (lotes físicos de productos enológicos, FEFO)
CREATE TABLE IF NOT EXISTS product_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  supplier_lot TEXT NOT NULL,
  supplier TEXT,
  received_at TEXT NOT NULL,
  expires_at TEXT,
  qty_initial REAL NOT NULL,
  qty_available REAL NOT NULL,
  unit_cost REAL,
  invoice_no TEXT,
  status TEXT NOT NULL DEFAULT 'active',             -- active | quarantine | withdrawn | discarded | depleted
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES product_batches(id),
  moved_at TEXT NOT NULL,
  qty REAL NOT NULL,                                 -- negativo = consumo
  reason TEXT NOT NULL,                              -- addition | count | adjustment | discard | receipt
  operation_id INTEGER,
  notes TEXT
);
ALTER TABLE operation_lines ADD COLUMN batch_id INTEGER;

-- ---------- embotellado
CREATE TABLE IF NOT EXISTS finished_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,                                     -- tinto | blanco | rosado | espumoso | generoso
  vintage INTEGER,
  variety TEXT,
  bottle_ml INTEGER,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bottling_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES finished_products(id),
  lot_code TEXT NOT NULL,
  source_lot_id INTEGER REFERENCES lots(id),
  vessel_id INTEGER REFERENCES vessels(id),
  bottled_at TEXT NOT NULL,
  volume_l REAL NOT NULL,
  bottle_ml INTEGER NOT NULL DEFAULT 750,
  bottles INTEGER NOT NULL,
  cases INTEGER,
  bottles_per_case INTEGER,
  operator_name TEXT,
  stage TEXT NOT NULL DEFAULT 'filled',              -- filled | labelled | packed
  labelled_at TEXT, packed_at TEXT,
  bottles_available INTEGER,
  operation_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
