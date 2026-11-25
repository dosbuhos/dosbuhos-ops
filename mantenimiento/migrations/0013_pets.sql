-- Mascotas (Eric, 25 Nov 2026): the animals of the estate are part of what is looked after. Each has a record (photo,
-- species, vet) and a history of vaccines, deworming and visits with the date the next one is due; a pendiente comes up
-- in the Bandeja a week before. Problems with an animal are reported like any other, tied to it.
CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  species TEXT,                                   -- Perro, Gato, Caballo...
  breed TEXT,
  sex TEXT,                                       -- 'macho' | 'hembra' | NULL
  born TEXT,                                      -- YYYY-MM-DD or YYYY, as known
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,   -- the vet
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pet_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'vacuna',            -- 'vacuna' | 'desparasitacion' | 'consulta' | 'otro'
  title TEXT NOT NULL,                            -- Rabia, Múltiple, Desparasitación interna...
  day TEXT NOT NULL,                              -- when it was done
  next_due TEXT,                                  -- when the next one is due
  cost REAL,
  notes TEXT,
  task_id INTEGER,                                -- the reminder made for next_due
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS pet_events_pet ON pet_events(pet_id, day);
ALTER TABLE photos ADD COLUMN pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL;
INSERT INTO areas (name, sort, color) SELECT 'Mascotas', COALESCE(MAX(sort), 0) + 1, 'amber' FROM areas WHERE NOT EXISTS (SELECT 1 FROM areas WHERE name = 'Mascotas');

-- Equipos by type (Eric, 25 Nov 2026): agua, cocina, cómputo, vehículos, maquinaria agrícola... with its state and who has it
-- (a laptop, a truck). category is a name from EQUIP_CATS in core.js; state: ok | falla | reparacion | baja | NULL (por confirmar).
ALTER TABLE equipment ADD COLUMN category TEXT;
ALTER TABLE equipment ADD COLUMN state TEXT;
ALTER TABLE equipment ADD COLUMN holder_id INTEGER REFERENCES providers(id) ON DELETE SET NULL;
-- Mobiliario (Eric, 25 Nov 2026): chairs and tables are inventoried here too; one row can be a set ("20 sillas"),
-- and each piece can carry an inventory number on a tag underneath (serial holds it).
ALTER TABLE equipment ADD COLUMN qty INTEGER;
