-- Reservaciones: the guests behind OpenTable reservations (name, phone, email) and how far the read from Klaviyo has
-- got. Nothing else lives here: the reservations, the Parrot checks and the Stripe payments stay in the growth
-- database, which this app only reads.

-- One row per reservation whose booker is known. Deleted 90 days after the visit (src/huespedes.js).
CREATE TABLE guests (
  confirmation_id TEXT PRIMARY KEY,           -- OpenTable's confirmation number (ot_reservations.confirmation_id in growth)
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  service_date TEXT NOT NULL,                 -- local day of the visit; decides when the row is deleted
  event_at INTEGER NOT NULL,                  -- time of the newest event these details came from (ms)
  updated_at INTEGER NOT NULL
);
CREATE INDEX guests_service_date ON guests (service_date);

-- Where the read of each Klaviyo reservation metric stopped, so the next run continues from there.
CREATE TABLE guest_sync (
  metric TEXT PRIMARY KEY,                    -- Klaviyo's metric name (Created Reservation, ...)
  cursor TEXT,                                -- time of the last event read (ISO 8601)
  done INTEGER NOT NULL DEFAULT 0,            -- 1 once the history has been read to the present
  updated_at INTEGER NOT NULL
);

-- The last run, for the "actualizado hace ..." line and for telling a silent failure from "no new reservations".
CREATE TABLE sync_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run_at INTEGER,
  last_ok_at INTEGER,
  last_error TEXT NOT NULL DEFAULT '',        -- in plain words; never a guest's data
  events INTEGER NOT NULL DEFAULT 0,          -- events read in the last run
  stored INTEGER NOT NULL DEFAULT 0,          -- guests written in the last run
  purged INTEGER NOT NULL DEFAULT 0           -- guests deleted for age in the last run
);
INSERT INTO sync_status (id) VALUES (1);
