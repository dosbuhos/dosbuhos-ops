-- Spark Equipo: copies of the reps' CRM sheet and of Zoho sales documents, plus who is who.
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona TEXT NOT NULL,            -- 'José Luis' | 'Carlos' | 'Daniel'
  fecha TEXT NOT NULL,              -- YYYY-MM-DD
  zona TEXT, cuenta TEXT, tipo TEXT, distribuidor TEXT, actividad TEXT, medio TEXT, etapa TEXT,
  contacto TEXT, telefono TEXT, muestras TEXT, resultado TEXT, siguiente_paso TEXT, proximo TEXT, pedido TEXT,
  origen TEXT NOT NULL DEFAULT 'hoja' -- 'hoja' = copied from the Google Sheet (replaced on every sync); 'app' = logged in Spark (kept)
);
CREATE INDEX activity_persona_fecha ON activity (persona, fecha);

CREATE TABLE orders (
  id TEXT PRIMARY KEY, numero TEXT, fecha TEXT, cliente_id TEXT, cliente TEXT, vendedor TEXT,
  total REAL, estado TEXT, facturacion TEXT, pago TEXT
);
CREATE INDEX orders_fecha ON orders (fecha);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY, fecha TEXT, cliente_id TEXT, cliente TEXT, vendedor TEXT, total REAL, estado TEXT
);
CREATE INDEX invoices_fecha ON invoices (fecha);

-- Zoho legal name -> the names the reps use in the CRM, separated by |
CREATE TABLE alias (cliente TEXT PRIMARY KEY, claves TEXT NOT NULL, nota TEXT);

-- Hub sign-in email -> whose numbers they see. rol: 'rep' sees their own, 'admin' sees everyone.
CREATE TABLE people (email TEXT PRIMARY KEY, persona TEXT, rol TEXT NOT NULL DEFAULT 'rep');

-- Sync cursors, last run times and last errors.
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
