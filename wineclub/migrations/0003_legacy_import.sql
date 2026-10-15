-- v3: legacy WordPress app (staging.dosbuhos.com/wineclubadmin) as a migration source, plus explicit
-- fulfillment method and attribution. Non-destructive.

ALTER TABLE fulfillments ADD COLUMN method TEXT;        -- 'pickup' (recogió en bodega) | 'signup' (se lo llevó al inscribirse) | 'courier'
ALTER TABLE fulfillments ADD COLUMN handled_by TEXT;    -- who physically handed over / shipped (may differ from who typed it)
ALTER TABLE fulfillments ADD COLUMN requested_on TEXT;  -- date the member asked for delivery, if any
ALTER TABLE fulfillments ADD COLUMN legacy_id TEXT;     -- source record id in the legacy app (traceability, no double import)
CREATE UNIQUE INDEX fulfillments_legacy ON fulfillments(legacy_id) WHERE legacy_id IS NOT NULL;
ALTER TABLE members ADD COLUMN legacy_id TEXT;

-- Raw copy of the legacy data, kept as extracted. The import reads from here and records the outcome per row.
CREATE TABLE legacy_members (
  legacy_id TEXT PRIMARY KEY,
  name TEXT, email TEXT, phone TEXT,
  club_key TEXT,                 -- founders | bronce | plata | oro | diamante | '' (none)
  next_shipment_number INTEGER,
  stripe_status TEXT, plan_price TEXT, notes TEXT,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE legacy_shipments (
  legacy_id TEXT PRIMARY KEY,
  legacy_member_id TEXT NOT NULL,
  shipment_number INTEGER,
  status TEXT, source TEXT,
  requested_date TEXT, fulfilled_at TEXT,
  method TEXT, handled_by TEXT, zoho_po TEXT, tracking TEXT, notes TEXT,
  alloc_json TEXT,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  imported_at TEXT, result TEXT  -- what the import did with this row
);
