-- Two-way running with Excellovint: a hash per row so the 5-minute pull only writes rows that changed.
ALTER TABLE xl_rows ADD COLUMN h TEXT;
