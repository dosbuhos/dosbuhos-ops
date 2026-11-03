-- Ulula · bodega por recipientes (estancias de lotes en depósitos)
-- Cada operación mueve litros entre recipientes; el lote sigue al vino.

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  room TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vessels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  capacity_l REAL NOT NULL,
  vessel_type TEXT NOT NULL DEFAULT 'storage',      -- fermentation | storage | aging
  material TEXT NOT NULL DEFAULT 'stainless_steel',  -- stainless_steel | concrete | oak | fiberglass | clay | chestnut | acacia | ceramic | glass | terracotta | plastic
  kind TEXT NOT NULL DEFAULT 'tank',                 -- tank | foudre | barrel | bin | keg | amphora | egg | tirage_cage | press | carboy
  location_id INTEGER REFERENCES locations(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  always_full INTEGER NOT NULL DEFAULT 0,            -- tapa flotante / capacidad variable: no entra en alertas de rellenado
  fill_count INTEGER NOT NULL DEFAULT 0,
  cooperage TEXT, wood_origin TEXT, toast_level TEXT, barrel_format TEXT, acquisition_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  wine_type TEXT NOT NULL DEFAULT 'blanco',          -- tinto | blanco | rosado | espumoso | base_blanco | base_rosado | naranja | piquette
  vintage INTEGER,
  varieties TEXT,
  phase TEXT NOT NULL DEFAULT 'crianza',             -- recepcion | fermentacion | posfermentacion | fml | crianza | preembotellado
  creation_method TEXT NOT NULL DEFAULT 'manual',    -- manual | harvest | pressing | blend | lees | split
  unit TEXT NOT NULL DEFAULT 'L',                    -- L | kg (uva en maceración)
  status TEXT NOT NULL DEFAULT 'active',             -- active | closed
  fermentation_done INTEGER NOT NULL DEFAULT 1,
  parent_lot_id INTEGER REFERENCES lots(id),
  created_by_op INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Una estancia = un lote dentro de un recipiente durante un periodo. Un recipiente tiene como máximo una estancia abierta.
CREATE TABLE IF NOT EXISTS stays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  vessel_id INTEGER NOT NULL REFERENCES vessels(id),
  entered_at TEXT NOT NULL,
  left_at TEXT,
  volume_in REAL NOT NULL,
  volume REAL NOT NULL,                              -- volumen actual (0 cuando cerrada)
  volume_out REAL,
  unit TEXT NOT NULL DEFAULT 'L',                    -- L | kg
  opened_by_op INTEGER,
  closed_by_op INTEGER
);
CREATE INDEX IF NOT EXISTS stays_open ON stays(vessel_id, left_at);
CREATE INDEX IF NOT EXISTS stays_lot ON stays(lot_id);

CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                                -- pressing | bleeding | racking | barrel_transfer | filtration | decantation | addition | topping | bulk_sale | blend
  op_date TEXT NOT NULL,
  operator_id INTEGER,
  operator_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',              -- draft | confirmed | reverted
  mode TEXT,                                         -- barrel_transfer: fill | empty
  press_vessel_id INTEGER,
  buyer TEXT,
  volume_l REAL,
  loss_l REAL NOT NULL DEFAULT 0,
  lees_l REAL NOT NULL DEFAULT 0,
  lees_vessel_id INTEGER,
  lees_lot_code TEXT,
  new_lot_json TEXT,                                 -- coupage: {code, wine_type, vintage, varieties, phase}
  notes TEXT,
  payload TEXT,                                      -- el formulario tal cual (borradores y reapertura)
  undo TEXT,                                         -- estado previo para Revertir
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  reverted_at TEXT
);
CREATE INDEX IF NOT EXISTS ops_date ON operations(op_date);

CREATE TABLE IF NOT EXISTS operation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES operations(id),
  side TEXT NOT NULL,                                -- origin | destination | product | lees
  vessel_id INTEGER,
  lot_id INTEGER,
  volume REAL,
  fraction TEXT,                                     -- prensado: free_run | press_1 | press_2 | press_3 | combined | pomace
  new_lot_code TEXT,
  product_id INTEGER,
  product_name TEXT,
  qty REAL,
  unit TEXT,
  line_note TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lines_op ON operation_lines(operation_id);
CREATE INDEX IF NOT EXISTS lines_vessel ON operation_lines(vessel_id);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  category TEXT NOT NULL DEFAULT 'other',            -- yeast | bacteria | enzyme | fining | acid | sulfite | tannin | nutrient | oak | sugar | concentrate | juice | other
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'g',
  supplier TEXT,
  min_stock REAL,
  concentration_gl REAL,
  apparent_vol_mlg REAL,
  allergen INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER REFERENCES lots(id),
  vessel_id INTEGER REFERENCES vessels(id),
  analysed_at TEXT NOT NULL,
  alcohol REAL, va REAL, ta REAL, ph REAL,
  so2_free REAL, so2_bound REAL, so2_total REAL, so2_molecular REAL,
  malic REAL, lactic REAL, rs REAL, brix REAL, temp REAL,
  analysed_by TEXT, source TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS analyses_lot ON analyses(lot_id, analysed_at);

CREATE TABLE IF NOT EXISTS tastings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER REFERENCES lots(id),
  vessel_id INTEGER REFERENCES vessels(id),
  tasted_at TEXT NOT NULL,
  taster TEXT,
  phase TEXT,
  score REAL,
  blind INTEGER NOT NULL DEFAULT 0,
  appearance TEXT, nose TEXT, palate TEXT, finish TEXT, overall TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cleaning_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vessel_id INTEGER NOT NULL REFERENCES vessels(id),
  cleaned_at TEXT NOT NULL,
  by_name TEXT,
  method TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  initials TEXT,
  role TEXT NOT NULL DEFAULT 'crew',                 -- admin | crew
  active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO users (name, initials, role) VALUES
  ('Eric', 'EM', 'admin'), ('Diane', 'D', 'admin'),
  ('Paris', 'P', 'crew'), ('Jimena', 'J', 'crew'), ('Eduvijes', 'V', 'crew'), ('Margaro', 'M', 'crew'), ('Jaime', 'JA', 'crew');
