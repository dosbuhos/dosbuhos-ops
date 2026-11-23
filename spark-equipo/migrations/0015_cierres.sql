-- Month-end close of the 48-hour rule: one row per person and month, frozen the day it is applied. `detalle` keeps the
-- contacts that were logged late (JSON), so each person sees why. `ensayo` marks a dry run that deducts nothing.
CREATE TABLE cierres (
  mes TEXT NOT NULL, persona TEXT NOT NULL,
  contactos INTEGER NOT NULL DEFAULT 0, tarde INTEGER NOT NULL DEFAULT 0,
  pct INTEGER,                                -- on time, 0 to 100; NULL when the month has no logged contacts
  ajuste INTEGER NOT NULL DEFAULT 0,          -- percent taken off the month's commission: 0, 15 or 30
  detalle TEXT NOT NULL DEFAULT '[]',
  ensayo INTEGER NOT NULL DEFAULT 0,
  aplicado TEXT NOT NULL, aplico TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (mes, persona)
);
-- A question from Dirección can carry the day the answer is due; it then shows as overdue in the inbox and on Mondays.
ALTER TABLE preguntas ADD COLUMN fecha TEXT NOT NULL DEFAULT '';
