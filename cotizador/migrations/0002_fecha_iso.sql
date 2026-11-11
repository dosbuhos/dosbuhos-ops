-- Fecha del evento en ISO (yyyy-mm-dd) para ordenar y filtrar; `fecha` sigue siendo el texto de la propuesta.
ALTER TABLE quotes ADD COLUMN fecha_iso TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS quotes_fecha ON quotes(fecha_iso);
