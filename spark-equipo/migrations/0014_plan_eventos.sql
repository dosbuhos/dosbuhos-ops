-- The 90-day plan: commitments with an owner, a due date and how each one is measured. A row starts as a draft that only
-- the owner of the account (the Hub admin) sees; publishing it shows it to the whole team.
CREATE TABLE compromisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona TEXT NOT NULL,                      -- who owns it: a rep, Ily, Dirección or Contabilidad
  titulo TEXT NOT NULL, medida TEXT NOT NULL DEFAULT '',   -- what will be done, and the evidence that it was
  fecha TEXT NOT NULL DEFAULT '', etapa TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | hecho
  hecho_fecha TEXT NOT NULL DEFAULT '', hecho_por TEXT NOT NULL DEFAULT '', nota TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 0, origen TEXT NOT NULL DEFAULT '', orden INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
CREATE INDEX compromisos_persona ON compromisos (persona, fecha);
-- Event requests: asked for with their numbers, approved or not, and closed afterwards with what came out of them.
CREATE TABLE eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona TEXT NOT NULL, nombre TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT '', lugar TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL,
  objetivo TEXT NOT NULL DEFAULT '', cuentas_objetivo TEXT NOT NULL DEFAULT '', distribuidor TEXT NOT NULL DEFAULT '',
  costo INTEGER NOT NULL DEFAULT 0, botellas INTEGER NOT NULL DEFAULT 0, venta_esperada INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'solicitado',  -- solicitado | aprobado | rechazado | cerrado
  decidio TEXT NOT NULL DEFAULT '', decidido TEXT NOT NULL DEFAULT '', nota_decision TEXT NOT NULL DEFAULT '',
  botellas_aprobadas INTEGER NOT NULL DEFAULT 0, costo_aprobado INTEGER NOT NULL DEFAULT 0,
  contactos INTEGER NOT NULL DEFAULT 0, cuentas_nuevas INTEGER NOT NULL DEFAULT 0, botellas_usadas INTEGER NOT NULL DEFAULT 0,
  venta_real INTEGER NOT NULL DEFAULT 0, reporte TEXT NOT NULL DEFAULT '', cerrado TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
-- A promotion can carry per-account targets, as JSON: [{ "cuenta": "...", "clientes": ["Zoho name", ...], "base": 0, "objetivo": 0 }].
-- With them Spark shows how far each account is from earning it.
ALTER TABLE promociones ADD COLUMN metas TEXT NOT NULL DEFAULT '';
