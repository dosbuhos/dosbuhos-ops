-- Parrot POS (api.parrot.rest/external): orders, line items and payments, read hourly. Money in MXN cents.
-- local_date is the San Miguel business date of the order's creation. Guest counts (customers) are only trusted from
-- POS_GUESTS_RELIABLE_FROM (src/connectors/parrot.ts): staff started recording them consistently on 2026-11-04.
CREATE TABLE pos_orders (
  uuid TEXT PRIMARY KEY,
  store_uuid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL,                 -- FINISHED, CANCELLED, ...
  order_type TEXT NOT NULL DEFAULT '',  -- DINE_IN, TAKE_OUT, ...
  order_type_name TEXT NOT NULL DEFAULT '',
  table_name TEXT NOT NULL DEFAULT '',
  customers INTEGER,                    -- customersCount
  total_minor INTEGER NOT NULL,         -- after discounts, IVA included
  taxes_minor INTEGER NOT NULL DEFAULT 0,
  discounts_minor INTEGER NOT NULL DEFAULT 0,
  reference TEXT NOT NULL DEFAULT '',
  fetched_at INTEGER NOT NULL
);
CREATE INDEX pos_orders_date ON pos_orders(local_date);
CREATE TABLE pos_items (
  uuid TEXT PRIMARY KEY,
  order_uuid TEXT NOT NULL,
  local_date TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,          -- IVA included, after item discount
  subtotal_minor INTEGER,                -- without IVA
  status TEXT NOT NULL DEFAULT '',
  fetched_at INTEGER NOT NULL
);
CREATE INDEX pos_items_date ON pos_items(local_date);
CREATE TABLE pos_payments (
  uuid TEXT PRIMARY KEY,
  order_uuid TEXT NOT NULL,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_type TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL,
  tip_minor INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX pos_payments_date ON pos_payments(local_date);
-- Which 48-hour windows have been read, so the backfill resumes where it stopped.
CREATE TABLE pos_sync_windows (endpoint TEXT NOT NULL, window_start TEXT NOT NULL, done_at INTEGER NOT NULL, rows INTEGER NOT NULL, PRIMARY KEY (endpoint, window_start));
INSERT OR IGNORE INTO connections (id, provider, purpose, health, health_reason, updated_at) VALUES ('conn_parrot', 'parrot', 'Ventas, comensales y pagos del punto de venta (Parrot)', 'not_configured', 'Falta el secreto PARROT_API_KEY', 0);
