-- Club de beneficios: what Join It does that the club didn't yet. Validity and renewals, fees and payments, the
-- questions each program asks at sign-up (form builder), and the guest's own data on the card.

-- A program can last a set number of months (0 = no expiry) and have a fee and a payment link (e.g. a Stripe link).
ALTER TABLE club_programs ADD COLUMN duration_months INTEGER NOT NULL DEFAULT 0;
ALTER TABLE club_programs ADD COLUMN fee_mxn REAL NOT NULL DEFAULT 0;
ALTER TABLE club_programs ADD COLUMN pay_url TEXT NOT NULL DEFAULT '';

-- Each membership can expire. '' = no expiry. Expired memberships stay 'active' in the table and simply stop applying
-- after this day, so renewing is one date change and the history is not lost.
ALTER TABLE club_memberships ADD COLUMN expires_on TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS club_memberships_expires ON club_memberships(expires_on) WHERE expires_on <> '';

-- Fees received (cash, transfer, card at the venue, Stripe…). Not purchases: they don't count toward purchase levels.
CREATE TABLE IF NOT EXISTS club_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES club_people(id),
  membership_id INTEGER REFERENCES club_memberships(id),
  program_id TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,                      -- YYYY-MM-DD the money came in
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'efectivo', -- efectivo, transferencia, tarjeta, stripe, otro
  reference TEXT NOT NULL DEFAULT '',     -- folio, last 4, Stripe receipt…
  note TEXT NOT NULL DEFAULT '',
  extended_to TEXT NOT NULL DEFAULT '',   -- the new expiry this payment set, if it renewed
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  voided_at INTEGER,
  voided_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS club_payments_person ON club_payments(person_id, day);
CREATE INDEX IF NOT EXISTS club_payments_day ON club_payments(day);

-- Questions (form builder). program_id '' = asked for every program. staff_only = never shown to the guest
-- (e.g. "Quién lo recomendó", "Talla de playera"). Options for 'choice' are one per line.
CREATE TABLE IF NOT EXISTS club_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  help TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'choice', 'yes_no', 'date')),
  options TEXT NOT NULL DEFAULT '',
  program_id TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 0,
  staff_only INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS club_field_values (
  person_id INTEGER NOT NULL REFERENCES club_people(id),
  field_id INTEGER NOT NULL REFERENCES club_fields(id),
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, field_id)
);
