-- "Otro lugar" in Reportar: a place written by hand when the problem is somewhere that is not on the list of areas.
-- It travels with that pendiente only; it does not become an area unless an administrator adds it to the list.
ALTER TABLE tasks ADD COLUMN place TEXT;
