-- Mantenimiento Dos Búhos — esquema inicial

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',          -- 'admin' | 'staff'
  active INTEGER NOT NULL DEFAULT 1,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Responsables: personal interno (Adrián, carpinteros) y proveedores externos (plomero, A/C…)
CREATE TABLE providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'externo',        -- 'interno' | 'externo'
  specialty TEXT,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area_id INTEGER REFERENCES areas(id),
  location TEXT,
  brand_model TEXT,
  serial TEXT,
  provider_id INTEGER REFERENCES providers(id),
  service_interval_days INTEGER,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'tarea',          -- 'tarea' | 'servicio' (registro de mantenimiento a equipo)
  area_id INTEGER REFERENCES areas(id),
  equipment_id INTEGER REFERENCES equipment(id),
  priority INTEGER NOT NULL DEFAULT 2,         -- 1 urgente, 2 alta, 3 normal, 4 baja
  status TEXT NOT NULL DEFAULT 'pendiente',    -- pendiente | en_proceso | en_espera | hecha | cancelada
  provider_id INTEGER REFERENCES providers(id),
  due_date TEXT,                               -- fecha estimada (YYYY-MM-DD)
  cost REAL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_area ON tasks(area_id);
CREATE INDEX idx_tasks_provider ON tasks(provider_id);
CREATE INDEX idx_tasks_equipment ON tasks(equipment_id);

CREATE TABLE task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'nota',           -- 'nota' | 'sistema'
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notes_task ON task_notes(task_id);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  r2_key TEXT,                                 -- si se usa R2
  data BLOB,                                   -- si no hay R2, la foto comprimida vive aquí
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_task ON photos(task_id);
CREATE INDEX idx_photos_equipment ON photos(equipment_id);

INSERT INTO areas (name, sort) VALUES
  ('Instalaciones', 1),
  ('Jardín y huerta', 2),
  ('Restaurante', 3),
  ('Bodega y cava', 4),
  ('Eventos', 5),
  ('Hospedaje', 6),
  ('Capilla / Contemplo', 7),
  ('Viñedo', 8),
  ('Oficina', 9);
