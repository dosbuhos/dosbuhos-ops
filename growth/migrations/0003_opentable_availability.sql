-- Bookable times on OpenTable's public booking page (the same queries canario uses; no login). Restaurant tables by
-- party size, and each Experience. A count of bookable times, not seats: 0 on an open day means nothing can be booked.
CREATE TABLE ot_availability (
  date TEXT NOT NULL,                 -- winery date
  product TEXT NOT NULL,              -- restaurant_visit | tour_tasting
  item TEXT NOT NULL,                 -- 'tables' or the experience name
  party_size INTEGER NOT NULL,
  slots INTEGER,                      -- bookable times; NULL = could not be read
  error TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (date, product, item, party_size)
);
CREATE INDEX ot_availability_date ON ot_availability(date);
