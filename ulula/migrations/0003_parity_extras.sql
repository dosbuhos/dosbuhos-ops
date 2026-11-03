-- Paridad con GrapeFlow (módulos avanzados): alertas, conciliación de volúmenes, registro de limpieza ampliado,
-- parcelas de uva comprada, materiales secos, equipos, operarios sin acceso, claves de API.
ALTER TABLE company ADD COLUMN alerts TEXT;
ALTER TABLE company ADD COLUMN reconcile_tolerance_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE company ADD COLUMN reconcile_self_approve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE company ADD COLUMN cleaning_four_eyes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE company ADD COLUMN country TEXT;
ALTER TABLE users ADD COLUMN login INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN applicator_cert TEXT;
ALTER TABLE users ADD COLUMN cert_expires TEXT;
ALTER TABLE cleaning_records ADD COLUMN protocol TEXT NOT NULL DEFAULT 'cleaning';
ALTER TABLE cleaning_records ADD COLUMN status TEXT NOT NULL DEFAULT 'registered';
ALTER TABLE cleaning_records ADD COLUMN verified_by TEXT;
ALTER TABLE cleaning_records ADD COLUMN verified_at TEXT;
ALTER TABLE cleaning_records ADD COLUMN equipment_id INTEGER;
ALTER TABLE cleaning_records ADD COLUMN products TEXT;
CREATE TABLE IF NOT EXISTS supplier_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  supplier TEXT,
  variety TEXT,
  locality TEXT,
  area_ha REAL,
  wine_type TEXT,
  production_mode TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  brand TEXT, model TEXT, serial TEXT,
  location_id INTEGER REFERENCES locations(id),
  acquisition_date TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS packaging_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  unit TEXT NOT NULL DEFAULT 'unidad',
  min_stock REAL,
  supplier TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS packaging_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES packaging_materials(id),
  moved_at TEXT NOT NULL,
  qty REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT 'receipt',
  supplier_lot TEXT, invoice_no TEXT, unit_cost REAL,
  bottling_id INTEGER,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measured_at TEXT NOT NULL,
  vessel_id INTEGER NOT NULL REFERENCES vessels(id),
  lot_id INTEGER REFERENCES lots(id),
  system_l REAL NOT NULL,
  measured_l REAL NOT NULL,
  diff_l REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT 'measurement',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  measured_by TEXT,
  approved_by TEXT, approved_at TEXT,
  operation_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
