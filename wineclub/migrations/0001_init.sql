-- Wine club logistics, schema v1.
-- Concepts: MEMBER → SUBSCRIPTION (from Stripe) → expected shipments (computed, not stored)
-- → FULFILLMENT (what staff actually did with one expected shipment).

CREATE TABLE clubs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  bottles INTEGER NOT NULL,                       -- bottles per shipment
  cadence_months INTEGER NOT NULL,                -- 3 = quarterly, 1 = monthly
  allocation_mode TEXT NOT NULL DEFAULT 'sequence', -- 'sequence': case by shipment #, 'month': case by calendar month
  legacy INTEGER NOT NULL DEFAULT 0,              -- closed to new members
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  keywords TEXT                                   -- words that auto-match a Stripe product name
);

-- What goes in each case of a club's schedule (slot 1..4 for quarterly, 1..12 for monthly).
CREATE TABLE club_cases (
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  slot INTEGER NOT NULL,
  bottles_json TEXT NOT NULL,                     -- [{"wine":"Tempranillo GR","qty":2}, ...]
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (club_id, slot)
);

CREATE TABLE club_benefits (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  name TEXT NOT NULL,
  quantity REAL,                                  -- NULL = not counted, just logged
  unit TEXT NOT NULL DEFAULT 'veces',
  period TEXT NOT NULL DEFAULT 'year',            -- 'year' (membership year) | 'once'
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Stripe products seen in sync, and the club each one means.
CREATE TABLE stripe_products (
  product_id TEXT PRIMARY KEY,
  name TEXT,
  club_id INTEGER REFERENCES clubs(id),
  mapped_by TEXT,
  mapped_at TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,                 -- NULL for members added by hand
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  stripe_address TEXT,                            -- refreshed from Stripe on every sync
  delivery_address TEXT,                          -- staff-maintained; never overwritten by sync
  delivery_pref TEXT NOT NULL DEFAULT 'recoge',   -- 'recoge' (pickup) | 'envio' (delivery)
  staff_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  stripe_subscription_id TEXT UNIQUE,             -- NULL for manual subscriptions
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  price_amount INTEGER,
  price_currency TEXT,
  billing_interval TEXT,
  billing_interval_count INTEGER,
  club_id_override INTEGER REFERENCES clubs(id),  -- manager correction; otherwise the product's club
  status TEXT NOT NULL,                           -- Stripe status, or 'manual' / 'manual_ended'
  start_date TEXT NOT NULL,                       -- local YYYY-MM-DD; shipment #1 date
  anchor_override TEXT,                           -- manager correction of shipment #1 date
  seq_offset INTEGER NOT NULL DEFAULT 0,          -- manager correction of shipment numbering
  ended_on TEXT,                                  -- first date no longer owed
  cancel_at TEXT,                                 -- scheduled cancellation
  missing_in_stripe INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX subscriptions_member ON subscriptions(member_id);

CREATE TABLE pauses (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  from_date TEXT NOT NULL,
  until_date TEXT,                                -- NULL = still paused
  source TEXT NOT NULL DEFAULT 'manual',          -- 'stripe' (pause_collection) | 'manual'
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX pauses_sub ON pauses(subscription_id);

-- One row per expected shipment that anyone has touched. k = occurrence index from the anchor.
CREATE TABLE fulfillments (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  k INTEGER NOT NULL,
  expected_date TEXT,                             -- expected date when first recorded (history)
  status TEXT,                                    -- needs_prep|ready|handed|shipped|delivered|exception|skipped; NULL = scheduled
  delayed_until TEXT,
  delay_reason TEXT,
  bottles_json TEXT,                              -- snapshot (or custom list) — never recomputed
  bottles_custom INTEGER NOT NULL DEFAULT 0,
  order_ref TEXT,                                 -- Zoho order / PO
  carrier TEXT,
  tracking TEXT,
  done_on TEXT,
  delivered_on TEXT,
  note TEXT,
  stripe_invoice_id TEXT,
  paid_on TEXT,
  paid_amount INTEGER,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subscription_id, k)
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  fulfillment_id INTEGER NOT NULL REFERENCES fulfillments(id),
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  data BLOB,
  r2_key TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX photos_fulfillment ON photos(fulfillment_id);

CREATE TABLE benefit_uses (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  benefit_id INTEGER NOT NULL REFERENCES club_benefits(id),
  qty REAL NOT NULL DEFAULT 1,
  used_on TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX benefit_uses_member ON benefit_uses(member_id);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT,
  api_version TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  error TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  note TEXT
);
CREATE INDEX audit_entity ON audit_log(entity, entity_id);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

-- ---------- starting data ----------
INSERT INTO clubs (id, name, bottles, cadence_months, legacy, sort, keywords) VALUES
  (1, 'Socios Fundadores', 6, 3, 1, 1, 'fundador,fundadores'),
  (2, 'Círculo Bronce', 6, 3, 0, 2, 'bronce'),
  (3, 'Círculo Plata', 12, 3, 0, 3, 'plata'),
  (4, 'Círculo Oro', 6, 1, 0, 4, 'oro'),
  (5, 'Círculo Diamante', 12, 1, 0, 5, 'diamante');

INSERT INTO club_benefits (club_id, name, quantity, unit, period, sort) VALUES
  (1, 'Kit de bienvenida', 1, 'kit', 'once', 1),
  (1, 'Tour y degustación', 4, 'personas', 'year', 2),
  (1, 'Degustación en sala de barricas', 4, 'personas', 'year', 3),
  (1, 'Evento de Ensamblaje', NULL, 'personas', 'year', 4),
  (2, 'Catas de cortesía', 4, 'personas', 'year', 1),
  (3, 'Catas de cortesía', 8, 'personas', 'year', 1),
  (4, 'Catas de cortesía', 10, 'personas', 'year', 1),
  (4, 'Aglianico (asignación)', 1, 'botellas', 'year', 2),
  (4, 'Chenin Blanc (asignación)', 4, 'botellas', 'year', 3),
  (5, 'Catas de cortesía', 12, 'personas', 'year', 1),
  (5, 'Aglianico (asignación)', 2, 'botellas', 'year', 2),
  (5, 'Chenin Blanc (asignación)', 8, 'botellas', 'year', 3),
  (5, 'La Cena de Diamante', 2, 'lugares', 'year', 4),
  (5, 'Crédito para renta del pabellón', 10000, 'MXN', 'year', 5);

INSERT INTO settings (key, value) VALUES ('tracking_start', '2026-01-01');
