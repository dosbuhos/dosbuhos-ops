-- Online reservations from GA4: OpenTable's Google Analytics integration sends the event `ot-reservation-made` for each
-- reservation made through the OpenTable widget. GA4 gives daily aggregates (not individual bookings), by the session's
-- source / medium / campaign. Phone and walk-in bookings are not in GA4; cancellations are not removed.
CREATE TABLE ga4_reservations_daily (
  date TEXT NOT NULL,                 -- GA4 property-timezone date of the event (when the reservation was made)
  source TEXT NOT NULL,
  medium TEXT NOT NULL,
  campaign TEXT NOT NULL,
  event_name TEXT NOT NULL,
  events INTEGER NOT NULL,
  value_micros INTEGER,               -- GA4 event value as sent by OpenTable (may be empty or a fixed value)
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (date, source, medium, campaign, event_name)
);
CREATE INDEX ga4_reservations_date ON ga4_reservations_daily(date);
