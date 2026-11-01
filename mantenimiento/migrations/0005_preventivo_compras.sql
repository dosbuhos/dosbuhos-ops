-- Preventivo, compras de material, motivo de espera, garantía/manual de equipos.
-- La app funciona sin esta migración (oculta lo nuevo) hasta que se aplica.

ALTER TABLE tasks ADD COLUMN wait_reason TEXT;        -- 'material' | 'proveedor' (solo con status en_espera)
ALTER TABLE tasks ADD COLUMN pm_id INTEGER;            -- plan preventivo que la generó
ALTER TABLE equipment ADD COLUMN warranty_until TEXT;  -- YYYY-MM-DD
ALTER TABLE equipment ADD COLUMN manual_url TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);

-- Planes de mantenimiento preventivo: generan órdenes solas (al abrir la app y con el Cron diario)
CREATE TABLE IF NOT EXISTS pm_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  area_id INTEGER REFERENCES areas(id),
  equipment_id INTEGER REFERENCES equipment(id),
  provider_id INTEGER REFERENCES providers(id),
  priority INTEGER NOT NULL DEFAULT 3,
  every_n INTEGER,                               -- cada N…
  unit TEXT NOT NULL DEFAULT 'month',            -- 'day' | 'week' | 'month' | 'once'
  next_due TEXT NOT NULL,                        -- próxima fecha (YYYY-MM-DD)
  lead_days INTEGER NOT NULL DEFAULT 3,          -- la orden se crea N días antes
  active INTEGER NOT NULL DEFAULT 1,
  last_task_id INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pm_next ON pm_schedules(active, next_due);
CREATE INDEX IF NOT EXISTS idx_pm_equipment ON pm_schedules(equipment_id);

-- Pedidos de material (ligados a una orden o sueltos)
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  qty TEXT,
  status TEXT NOT NULL DEFAULT 'pedido',         -- pedido | comprado | recibido | cancelado
  cost REAL,
  provider_id INTEGER REFERENCES providers(id),
  notes TEXT,
  requested_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  bought_at TEXT,
  received_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_task ON purchases(task_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);

-- Los equipos que ya tenían "servicio cada N días" pasan a ser planes preventivos.
-- Próxima fecha = último servicio + intervalo (o hoy + intervalo si nunca se registró).
INSERT INTO pm_schedules (title, area_id, equipment_id, provider_id, every_n, unit, next_due, lead_days)
SELECT 'Servicio preventivo: ' || e.name, e.area_id, e.id, e.provider_id,
  CASE WHEN e.service_interval_days = 365 THEN 12
       WHEN e.service_interval_days % 30 = 0 THEN e.service_interval_days / 30
       WHEN e.service_interval_days % 7 = 0 THEN e.service_interval_days / 7
       ELSE e.service_interval_days END,
  CASE WHEN e.service_interval_days = 365 OR e.service_interval_days % 30 = 0 THEN 'month'
       WHEN e.service_interval_days % 7 = 0 THEN 'week'
       ELSE 'day' END,
  date(COALESCE((SELECT MAX(t.completed_at) FROM tasks t WHERE t.equipment_id = e.id AND t.status = 'hecha'),
                datetime('now', '-6 hours')), '+' || e.service_interval_days || ' days'),
  7
FROM equipment e WHERE e.active = 1 AND e.service_interval_days > 0;
