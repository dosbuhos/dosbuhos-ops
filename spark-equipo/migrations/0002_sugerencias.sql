-- Next step Claude suggests for an account, from the rep's own notes. One row per person and account; `firma` records which
-- notes it was written from, so it is only rewritten when the notes or the follow-up state change.
CREATE TABLE sugerencias (
  persona TEXT NOT NULL,
  clave   TEXT NOT NULL,           -- normalized account name (calc.js norm)
  firma   TEXT NOT NULL,
  texto   TEXT NOT NULL,
  creado  TEXT NOT NULL,           -- ISO date
  PRIMARY KEY (persona, clave)
);
