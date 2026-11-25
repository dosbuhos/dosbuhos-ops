-- Oficios as tags (Eric, 25 Nov 2026): one contact can do several things (plumbing and electrical and masonry), and
-- the list is filtered by them. A JSON array of names from TRADES in core.js.
ALTER TABLE providers ADD COLUMN tags TEXT;
