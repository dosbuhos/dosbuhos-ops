-- Cotizaciones guardadas: una fila por cotización, con los campos del formulario en `data` (JSON).
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  por TEXT NOT NULL DEFAULT '',          -- quién la preparó (campo "Prepara la propuesta")
  cliente TEXT NOT NULL DEFAULT '',
  evento TEXT NOT NULL DEFAULT '',
  fecha TEXT NOT NULL DEFAULT '',        -- texto libre, como sale en la propuesta
  pax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,      -- MXN, servicio e IVA incluidos
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','enviada','confirmada','cancelada')),
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS quotes_updated ON quotes(updated_at DESC);
