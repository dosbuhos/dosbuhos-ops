-- Buzón: which inbox notes each person has marked as done. The notes themselves are computed, so we only keep the key.
CREATE TABLE buzon_hechos (
  email TEXT NOT NULL,
  clave TEXT NOT NULL,
  fecha TEXT NOT NULL,
  PRIMARY KEY (email, clave)
);
