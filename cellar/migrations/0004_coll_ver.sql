-- Cheap freshness check for /api/db polling (already applied to production 2026-11-03).
CREATE TABLE IF NOT EXISTS coll_ver (coll TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO coll_ver (coll, v) SELECT DISTINCT coll, 1 FROM docs;
CREATE TRIGGER IF NOT EXISTS docs_ver_i AFTER INSERT ON docs BEGIN INSERT INTO coll_ver(coll,v) VALUES (NEW.coll,1) ON CONFLICT(coll) DO UPDATE SET v = v + 1; END;
CREATE TRIGGER IF NOT EXISTS docs_ver_u AFTER UPDATE ON docs BEGIN INSERT INTO coll_ver(coll,v) VALUES (NEW.coll,1) ON CONFLICT(coll) DO UPDATE SET v = v + 1; END;
CREATE TRIGGER IF NOT EXISTS docs_ver_d AFTER DELETE ON docs BEGIN INSERT INTO coll_ver(coll,v) VALUES (OLD.coll,1) ON CONFLICT(coll) DO UPDATE SET v = v + 1; END;
