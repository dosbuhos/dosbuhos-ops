CREATE TABLE IF NOT EXISTS reps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  whatsapp TEXT,
  code TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue TEXT,
  city TEXT,
  contact_name TEXT,
  role TEXT,
  whatsapp TEXT,
  email TEXT,
  stage TEXT DEFAULT 'spark',
  rep_id INTEGER,
  owner TEXT,
  summary TEXT,
  next_step TEXT,
  next_date TEXT,
  menu_text TEXT,
  last_inbound_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_wa ON leads(whatsapp);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  channel TEXT DEFAULT 'whatsapp',
  body TEXT,
  author TEXT,
  wa_id TEXT,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_lead ON messages(lead_id);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  data TEXT,
  status TEXT DEFAULT 'draft',
  views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  rep_id INTEGER,
  status TEXT DEFAULT 'scheduled',
  wines TEXT,
  notes TEXT,
  result_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  style TEXT,
  notes TEXT,
  price_horeca REAL,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO wines (id, name, style, notes) VALUES
 (1,'Aglianico','Tinto','Insignia de la casa; asignación limitada'),
 (2,'Tempranillo Gran Reserva','Tinto','Crianza larga, para carnes y platos de fondo'),
 (3,'Grenache','Tinto','Fruta roja, ligero; versátil por copa'),
 (4,'Chenin Blanc','Blanco','Acidez viva, mariscos y cocina fresca'),
 (5,'Sauvignon Blanc','Blanco','Herbal y cítrico; entradas, ceviches'),
 (6,'Mosaico Blanco','Blanco','Sauvignon Blanc / Sémillon / Moscato'),
 (7,'Moscato Giallo Pet Nat','Espumoso','Burbuja natural, aperitivo y postres'),
 (8,'Efímero (colección)','Ensamble','Línea de ensambles de edición limitada');
