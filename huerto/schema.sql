-- Huerto Dos Búhos · D1 schema (base de datos "huerto")
CREATE TABLE IF NOT EXISTS hechas (w INTEGER NOT NULL, task TEXT NOT NULL, done_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (w, task));
CREATE TABLE IF NOT EXISTS cosechas (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, cama TEXT NOT NULL, cultivo TEXT NOT NULL, cantidad REAL NOT NULL, u TEXT NOT NULL, nota TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
-- El PIN para editar vive en config (k='pin'); no se guarda en el repositorio.
