-- Club de beneficios: /club/ (staff + admin) and /c/… (public guest pages). Scope: CLUB-SCOPE.md, rules: src/club-core.js.
-- Programs are columns, benefits are rows, a cell says what a program gets. People can be in several programs; per benefit
-- the best value applies (no stacking). Purchase levels (Nivel 1/2/3) come from rolling 12-month spend: registered
-- visits + approved receipts + Círculo subscription charges read from the wineclub D1 (read-only binding WINECLUB_DB).

CREATE TABLE IF NOT EXISTS club_programs (
  id TEXT PRIMARY KEY,                    -- slug: nivel-1, amigos, pro-2 …
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'invitacion' CHECK (kind IN ('compras', 'invitacion', 'fundadores')),
  color TEXT NOT NULL DEFAULT '#6b2737',  -- badge colour; white text on it passes 4.5:1
  short_label TEXT NOT NULL DEFAULT '',   -- the OpenTable note and the shift text
  vip INTEGER NOT NULL DEFAULT 0,         -- members show under "VIP aquí ahora"
  is_pro INTEGER NOT NULL DEFAULT 0,      -- Profesionales: can be picked as "lo trajo"; Resumen counts what they bring
  requires_approval INTEGER NOT NULL DEFAULT 0, -- default for new invites of this program
  threshold_mxn REAL,                     -- compras: rolling-12-month spend that reaches this level
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS club_benefits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'count_per_year', 'yes_no', 'amount', 'text')),
  unit TEXT NOT NULL DEFAULT '',          -- %, personas, MXN …
  applies_to TEXT NOT NULL DEFAULT 'restaurante' CHECK (applies_to IN ('restaurante', 'tienda', 'experiencias', 'eventos')),
  rules TEXT NOT NULL DEFAULT '',         -- what staff read where they apply it; {g} = acompañantes of the cell
  phrase TEXT NOT NULL DEFAULT '',        -- what the guest reads on the card; {v} = value, {t} = text
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- A cell of the grid. No row = off.
CREATE TABLE IF NOT EXISTS club_cells (
  program_id TEXT NOT NULL REFERENCES club_programs(id),
  benefit_id TEXT NOT NULL REFERENCES club_benefits(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  value REAL,                             -- percent, count per year or amount
  text_value TEXT NOT NULL DEFAULT '',    -- text benefits ("Cata vertical")
  max_guests INTEGER,                     -- acompañantes covered besides the member; NULL = not limited / not relevant
  note TEXT NOT NULL DEFAULT '',          -- extra rule for this program
  confirmed INTEGER NOT NULL DEFAULT 0,   -- 0 = placeholder, shown "por confirmar" until the admin clears it
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (program_id, benefit_id)
);

CREATE TABLE IF NOT EXISTS club_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_code TEXT NOT NULL UNIQUE,         -- long random token: /c/<code>, the guest's only credential
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',         -- digits with country code (524151234567)
  email TEXT NOT NULL DEFAULT '',         -- lower-case
  birthday TEXT NOT NULL DEFAULT '',      -- MM-DD
  wedding_date TEXT NOT NULL DEFAULT '',  -- Novios: YYYY-MM-DD
  pro_type TEXT NOT NULL DEFAULT '',      -- Profesionales: tour_operador, wedding_planner, organizador_eventos, concierge, distribuidor, cliente
  staff_note TEXT NOT NULL DEFAULT '',    -- staff only, never on the guest card
  vip INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  source TEXT NOT NULL DEFAULT 'invite',  -- invite, novios, wineclub, manual
  wineclub_member_id INTEGER UNIQUE,
  terms_at INTEGER,
  card_sent_at INTEGER,                   -- last time staff sent the card by WhatsApp
  sub_commitment REAL NOT NULL DEFAULT 0, -- annual commitment of an active Círculo subscription (sync); sets the level if higher than spend
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS club_people_phone ON club_people(phone);
CREATE INDEX IF NOT EXISTS club_people_email ON club_people(email);
CREATE INDEX IF NOT EXISTS club_people_name ON club_people(name COLLATE NOCASE);

-- Who is in which program. Purchase levels are automatic and have no row, except a manual floor set by a manager.
CREATE TABLE IF NOT EXISTS club_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES club_people(id),
  program_id TEXT NOT NULL REFERENCES club_programs(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected', 'ended')),
  source TEXT NOT NULL DEFAULT 'invite',  -- invite, manual, wineclub, novios
  invite_id INTEGER,
  reason TEXT NOT NULL DEFAULT '',        -- why a manager moved them
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_by TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS club_memberships_live ON club_memberships(person_id, program_id) WHERE status IN ('active', 'pending');
CREATE INDEX IF NOT EXISTS club_memberships_program ON club_memberships(program_id, status);
CREATE INDEX IF NOT EXISTS club_memberships_status ON club_memberships(status, created_at);

CREATE TABLE IF NOT EXISTS club_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  program_id TEXT NOT NULL REFERENCES club_programs(id),
  kind TEXT NOT NULL DEFAULT 'link' CHECK (kind IN ('link', 'personal')),
  label TEXT NOT NULL DEFAULT '',         -- "Industria 2026"
  name TEXT NOT NULL DEFAULT '',          -- personal: who it is for
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  expires_at INTEGER,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS club_invites_program ON club_invites(program_id, created_at);

-- A visit registered by staff. What was paid (check_total − discount_total) counts toward purchase levels.
CREATE TABLE IF NOT EXISTS club_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES club_people(id),
  day TEXT NOT NULL,                      -- YYYY-MM-DD, San Miguel time
  time TEXT NOT NULL DEFAULT '',          -- HH:MM
  party_size INTEGER NOT NULL DEFAULT 1,
  parrot_check TEXT NOT NULL DEFAULT '',
  check_total REAL NOT NULL DEFAULT 0,    -- MXN, the Parrot check before the club discount
  discount_total REAL NOT NULL DEFAULT 0, -- MXN given
  brought_by INTEGER REFERENCES club_people(id), -- "lo trajo": a Profesional
  announcement_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  undone_at INTEGER,
  undone_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS club_visits_person ON club_visits(person_id, day);
CREATE INDEX IF NOT EXISTS club_visits_day ON club_visits(day);
CREATE INDEX IF NOT EXISTS club_visits_brought ON club_visits(brought_by, day);

CREATE TABLE IF NOT EXISTS club_visit_benefits (
  visit_id INTEGER NOT NULL REFERENCES club_visits(id),
  benefit_id TEXT NOT NULL REFERENCES club_benefits(id),
  program_id TEXT NOT NULL,               -- the program the benefit came from
  qty REAL NOT NULL DEFAULT 1,            -- people, for count benefits
  value REAL,                             -- the % or amount applied
  PRIMARY KEY (visit_id, benefit_id)
);
CREATE INDEX IF NOT EXISTS club_visit_benefits_benefit ON club_visit_benefits(benefit_id);

-- Purchases outside a registered visit: a guest's receipt (pending until staff approve) or staff's manual entry.
CREATE TABLE IF NOT EXISTS club_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES club_people(id),
  day TEXT NOT NULL,
  amount REAL NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('restaurante', 'tienda', 'en_linea', 'experiencias', 'punto_externo')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  source TEXT NOT NULL DEFAULT 'guest',   -- guest, staff
  note TEXT NOT NULL DEFAULT '',
  has_photo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at INTEGER,
  reject_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS club_purchases_person ON club_purchases(person_id, status, day);
CREATE INDEX IF NOT EXISTS club_purchases_status ON club_purchases(status, created_at);

-- Receipt photos, compressed in the browser to ~200 KB JPEG, base64. Separate so lists never load them.
CREATE TABLE IF NOT EXISTS club_photos (
  purchase_id INTEGER PRIMARY KEY REFERENCES club_purchases(id),
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  data TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Círculo subscription charges copied from the wineclub D1 on each sync (key = subscription:shipment).
CREATE TABLE IF NOT EXISTS club_sub_charges (
  key TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES club_people(id),
  day TEXT NOT NULL,
  amount REAL NOT NULL,
  estimated INTEGER NOT NULL DEFAULT 0,   -- 1 = no amount stored: the subscription price
  synced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS club_sub_charges_person ON club_sub_charges(person_id, day);

-- "Voy a ir": from the card (source guest) or from staff.
CREATE TABLE IF NOT EXISTS club_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES club_people(id),
  day TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL DEFAULT 1,
  reservation_name TEXT NOT NULL DEFAULT '', -- the name on the OpenTable reservation
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'guest',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS club_announcements_day ON club_announcements(day, cancelled_at);
CREATE INDEX IF NOT EXISTS club_announcements_person ON club_announcements(person_id, day);

-- "¿Perdiste tu tarjeta?" and "ya tenías tarjeta" requests. The page never says whether the number exists; staff resend
-- the card by WhatsApp from Hoy.
CREATE TABLE IF NOT EXISTS club_card_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  person_id INTEGER,
  reason TEXT NOT NULL DEFAULT 'perdida', -- perdida, ya_registrado
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  handled_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS club_card_requests_open ON club_card_requests(handled_at, created_at);
CREATE INDEX IF NOT EXISTS club_card_requests_phone ON club_card_requests(phone, created_at);

CREATE TABLE IF NOT EXISTS club_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,                    -- Hub user email, 'invitado' or 'sync'
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS club_audit_at ON club_audit(at);
CREATE INDEX IF NOT EXISTS club_audit_entity ON club_audit(entity, entity_id);

-- milestone_every (Profesionales), last_sync / last_sync_result (wine club).
CREATE TABLE IF NOT EXISTS club_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO club_config (key, value) VALUES ('milestone_every', '200');

-- ---------- starting data: every value is a placeholder (confirmed = 0, shown "por confirmar") ----------
INSERT OR IGNORE INTO club_programs (id, name, kind, color, short_label, vip, is_pro, requires_approval, threshold_mxn, sort) VALUES
  ('fundadores', 'Fundadores',        'fundadores', '#4a2a36', 'Fundador',      1, 0, 0, NULL,  5),
  ('novios',     'Novios',            'invitacion', '#7a5300', 'Novios',        0, 0, 0, NULL,  10),
  ('amigos',     'Amigos y familia',  'invitacion', '#8b2437', 'F&F',           1, 0, 0, NULL,  20),
  ('empleados',  'Empleados',         'invitacion', '#1f6b66', 'Equipo',        0, 0, 0, NULL,  30),
  ('pro-1',      'Profesionales 1',   'invitacion', '#2d5c8a', 'Profesional 1', 0, 1, 1, NULL,  40),
  ('pro-2',      'Profesionales 2',   'invitacion', '#244c74', 'Profesional 2', 0, 1, 1, NULL,  41),
  ('pro-3',      'Profesionales 3',   'invitacion', '#1b3a5c', 'Profesional 3', 1, 1, 1, NULL,  42),
  ('nivel-1',    'Nivel 1',           'compras',    '#6a5440', 'Nivel 1',       0, 0, 0, 0,     60),
  ('nivel-2',    'Nivel 2',           'compras',    '#55595e', 'Nivel 2',       0, 0, 0, 10000, 61),
  ('nivel-3',    'Nivel 3',           'compras',    '#6f5410', 'Nivel 3',       1, 0, 0, 20000, 62);

INSERT OR IGNORE INTO club_benefits (id, name, kind, unit, applies_to, rules, phrase, sort) VALUES
  ('restaurante', 'Descuento sobre toda la cuenta del restaurante', 'percent', '%', 'restaurante',
     'Socio presente · hasta {g} acompañantes · no se combina con otras promociones · una cuenta por visita',
     '{v}% de descuento en toda tu cuenta del restaurante', 10),
  ('vino', 'Descuento en vino para llevar — Tienda/en línea', 'percent', '%', 'tienda',
     'Botellas para llevar, en tienda o en línea · no aplica al vino en la mesa', '{v}% en vino para llevar, en tienda y en línea', 20),
  ('copa', 'Copa de bienvenida', 'yes_no', '', 'restaurante', 'Una copa por socio, por visita', 'Una copa de bienvenida en cada visita', 30),
  ('recorridos', 'Recorridos y degustaciones de cortesía', 'count_per_year', 'personas', 'experiencias',
     'Por persona, por año calendario · reservar antes', '{v} lugares de cortesía al año en recorridos y degustaciones', 40),
  ('vino-extra', '+1 vino extra en degustaciones', 'yes_no', '', 'experiencias', 'Un vino más en la degustación del socio y su grupo', 'Un vino extra en tus degustaciones', 50),
  ('eventos', 'Descuento en eventos', 'percent', '%', 'eventos', 'Eventos privados y bodas · no aplica a eventos con boleto', '{v}% en eventos privados', 60),
  ('catas', 'Catas comparativas de los viernes', 'yes_no', '', 'experiencias', 'Reservar antes del jueves · sujeto a cupo', 'Catas comparativas de los viernes', 70),
  ('experiencia', 'Experiencia exclusiva del nivel', 'text', '', 'experiencias', 'Se agenda con el equipo', '{t}', 80),
  ('vip', 'Acceso a áreas VIP', 'yes_no', '', 'experiencias', 'Sujeto a disponibilidad', 'Acceso a áreas VIP', 90),
  ('prioridad', 'Reservación prioritaria', 'yes_no', '', 'restaurante', 'Por WhatsApp con el equipo', 'Reservación prioritaria', 100),
  ('descorche', 'Descorche sin costo', 'yes_no', '', 'restaurante', 'Botellas compradas en Dos Búhos', 'Descorche sin costo', 110),
  ('asignacion', 'Vinos de asignación', 'yes_no', '', 'tienda', 'Vinos de producción limitada, cuando hay', 'Acceso a vinos de asignación', 120);

INSERT OR IGNORE INTO club_cells (program_id, benefit_id, enabled, value, text_value, max_guests, note) VALUES
  ('nivel-1',    'copa',        1, NULL, '', NULL, ''),
  ('nivel-1',    'vino',        1, 5,    '', NULL, ''),
  ('nivel-2',    'restaurante', 1, 10,   '', 4,    ''),
  ('nivel-2',    'vino',        1, 15,   '', NULL, ''),
  ('nivel-2',    'recorridos',  1, 4,    '', NULL, ''),
  ('nivel-2',    'eventos',     1, 20,   '', NULL, ''),
  ('nivel-3',    'restaurante', 1, 15,   '', 4,    ''),
  ('nivel-3',    'vino',        1, 20,   '', NULL, ''),
  ('nivel-3',    'recorridos',  1, 8,    '', NULL, ''),
  ('nivel-3',    'eventos',     1, 30,   '', NULL, ''),
  ('nivel-3',    'vip',         1, NULL, '', NULL, ''),
  ('fundadores', 'restaurante', 1, 10,   '', 4,    ''),
  ('fundadores', 'vino',        1, 20,   '', NULL, ''),
  ('fundadores', 'recorridos',  1, 4,    '', NULL, ''),
  ('fundadores', 'eventos',     1, 20,   '', NULL, ''),
  ('empleados',  'restaurante', 1, 30,   '', 4,    'Solo cuando el empleado está presente'),
  ('empleados',  'vino',        1, 10,   '', NULL, ''),
  ('amigos',     'restaurante', 1, 10,   '', 4,    ''),
  ('amigos',     'vino',        1, 25,   '', NULL, ''),
  ('novios',     'restaurante', 1, 10,   '', 4,    ''),
  ('novios',     'vino',        1, 15,   '', NULL, ''),
  ('novios',     'experiencia', 1, NULL, 'Una cata de aniversario cada año', NULL, ''),
  ('pro-1',      'restaurante', 1, 10,   '', 4,    ''),
  ('pro-1',      'vino',        1, 15,   '', NULL, ''),
  ('pro-2',      'restaurante', 1, 10,   '', 4,    ''),
  ('pro-2',      'vino',        1, 20,   '', NULL, ''),
  ('pro-3',      'restaurante', 1, 15,   '', 4,    ''),
  ('pro-3',      'vino',        1, 20,   '', NULL, '');

-- The Hub registry: the app lives inside the Hub at /club/ (Hospitalidad). It replaces the "Club de lealtad" placeholder.
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('club', 'Club de beneficios', 'hospitalidad', 'Tarjetas, invitaciones, quién llega hoy y qué beneficio aplica', 'live', 'internal', '/club/', '', 0, 15);
DELETE FROM grants WHERE slug = 'lealtad';
DELETE FROM apps WHERE slug = 'lealtad';
