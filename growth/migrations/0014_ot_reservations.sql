-- Reservations from OpenTable, read through Klaviyo's OpenTable integration (connected 2026-11-22). Klaviyo receives
-- every reservation event in real time; this keeps one row per reservation (OpenTable's confirmation number) and
-- brings it up to date from those events. No guest data: the guest's profile is never requested, and guest requests,
-- visit tags and the server's name are dropped on arrival (src/connectors/klaviyo-reservations.ts).
-- Times are UTC milliseconds; created_date and service_date are San Miguel dates.
CREATE TABLE ot_reservations (
  confirmation_id TEXT PRIMARY KEY,
  created_at INTEGER,                         -- when the reservation was made
  created_date TEXT,
  scheduled_at INTEGER,                       -- the reserved time
  service_date TEXT,
  party_size INTEGER,
  origin TEXT NOT NULL DEFAULT '',            -- web | phone | walk-in, as OpenTable reports it
  status TEXT NOT NULL,                       -- created | confirmed | completed | cancelled | no_show
  status_rank INTEGER NOT NULL,               -- 1 created, 2 confirmed, 3 the three final ones
  status_at INTEGER NOT NULL,                 -- time of the event that set the status
  table_name TEXT NOT NULL DEFAULT '',        -- as in OpenTable's floor plan (M1, ARC2, REC1 ...); several joined with +
  arrived_at INTEGER,
  seated_at INTEGER,
  done_at INTEGER,
  pos_total_minor INTEGER,                    -- only when OpenTable matched a point-of-sale check
  currency TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX ot_reservations_service ON ot_reservations(service_date);
CREATE INDEX ot_reservations_created ON ot_reservations(created_date);

-- One row per Klaviyo metric (Created Reservation, Confirmed ...): its id there and how far it has been read.
CREATE TABLE klaviyo_sync_state (
  metric TEXT PRIMARY KEY,                    -- the metric's name in Klaviyo
  metric_id TEXT,                             -- NULL until Klaviyo has it (a metric appears with its first event)
  cursor TEXT,                                -- datetime of the last event read (ISO 8601)
  done INTEGER NOT NULL DEFAULT 0,            -- 1 once the history has been read to the present
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO connections (id, provider, purpose, health, health_reason, updated_at)
VALUES ('conn_klaviyo', 'klaviyo', 'Todas las reservaciones de OpenTable, con su estado, cómo se reservó y su mesa (vía Klaviyo)', 'not_configured', 'Falta el secreto KLAVIYO_API_KEY: una llave privada de Klaviyo de solo lectura (Events y Metrics)', 0);
