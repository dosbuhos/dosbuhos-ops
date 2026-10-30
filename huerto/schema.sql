-- Huerto Dos Búhos · D1 schema (base de datos "huerto")
CREATE TABLE IF NOT EXISTS hechas (w INTEGER NOT NULL, task TEXT NOT NULL, done_at TEXT NOT NULL DEFAULT (datetime('now')), estado TEXT NOT NULL DEFAULT 'hecho', nota TEXT, txt TEXT, PRIMARY KEY (w, task));
-- estado: 'hecho' o 'ayuda' (Adrián necesita apoyo; nota opcional, txt = texto de la tarea)
CREATE TABLE IF NOT EXISTS cosechas (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, cama TEXT NOT NULL, cultivo TEXT NOT NULL, cantidad REAL NOT NULL, u TEXT NOT NULL, nota TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
-- El PIN para editar vive en config (k='pin'); no se guarda en el repositorio.
CREATE TABLE IF NOT EXISTS camas (id INTEGER PRIMARY KEY AUTOINCREMENT, cama TEXT NOT NULL, estado TEXT NOT NULL, m REAL NOT NULL, pos REAL, cultivo TEXT, fecha TEXT NOT NULL, cosecha TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
-- camas: reportes de estado real (limpia / lista / sembrada) que hace Adrián desde el mapa
CREATE TABLE IF NOT EXISTS mcp (k TEXT PRIMARY KEY, data TEXT NOT NULL, exp INTEGER NOT NULL);
-- mcp: clientes, códigos y tokens del conector de Claude (solo hashes SHA-256)
