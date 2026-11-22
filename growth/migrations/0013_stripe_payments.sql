-- Card payments from Stripe, read through the wine club Worker (service binding STRIPE, entrypoint StripeRead).
-- Every OpenTable prepayment is a charge in the same Stripe account as the club, so this one reader brings prepaid
-- experiences, the club, the web store and the old Rezdy tours. No personal data arrives here: the wine club Worker
-- removes names, emails, descriptions and metadata before answering (wineclub/src/payments.js).
-- Money in minor units (centavos). local_date is the San Miguel date the card was charged; service_date is the day
-- the guest reserved for (OpenTable only), which can be weeks later.
CREATE TABLE stripe_payments (
  id TEXT PRIMARY KEY,                        -- Stripe charge id
  created_at INTEGER NOT NULL,                -- ms
  local_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,              -- captured
  refunded_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                       -- succeeded | pending | failed | other
  disputed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,                       -- opentable | rezdy | web_store | wine_club | other
  kind TEXT NOT NULL DEFAULT '',              -- OpenTable transaction type (experiences, ...)
  experience_id TEXT NOT NULL DEFAULT '',     -- OpenTable experience (names in src/connectors/opentable-availability.ts)
  platform TEXT NOT NULL DEFAULT '',          -- where the guest booked, as OpenTable reports it (Diner App, ...)
  service_date TEXT,
  service_time TEXT,
  booking_ref TEXT NOT NULL DEFAULT '',       -- Rezdy order code
  card_country TEXT NOT NULL DEFAULT '',      -- where the card was issued
  application TEXT NOT NULL DEFAULT '',       -- Stripe Connect application that created the charge
  fetched_at INTEGER NOT NULL
);
CREATE INDEX stripe_payments_date ON stripe_payments(local_date);
CREATE INDEX stripe_payments_service ON stripe_payments(service_date);

-- Where the history load stands, so it resumes from one run to the next.
CREATE TABLE stripe_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  history_cursor TEXT,                        -- oldest charge read so far; the next page continues after it
  history_done INTEGER NOT NULL DEFAULT 0,
  refunds_read_at INTEGER,                    -- last time refunds were read without error (ms): a guest can cancel weeks after paying
  updated_at INTEGER NOT NULL
);
INSERT INTO stripe_sync_state (id, updated_at) VALUES (1, 0);

INSERT OR IGNORE INTO connections (id, provider, purpose, health, health_reason, updated_at)
VALUES ('conn_stripe', 'stripe', 'Pagos en línea con tarjeta: experiencias pagadas por adelantado en OpenTable, club de vinos y tienda (Stripe)', 'not_configured', 'Todavía no se ha leído', 0);
