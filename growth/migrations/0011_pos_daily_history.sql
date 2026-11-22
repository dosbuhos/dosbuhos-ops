-- Daily sales from the point of sale used before Parrot (Wansoft), September 2022 to August 2026. One row per
-- business day, loaded once from Wansoft's "Reporte de ventas por día" (Ajustes → Conexiones). Money in MXN cents.
-- Parrot (pos_orders) takes over on its first day; rows on or after that day are refused at load time.
-- The numbers themselves stay out of the repository: they go straight into D1.
CREATE TABLE pos_daily_history (
  local_date TEXT PRIMARY KEY,
  source TEXT NOT NULL,                     -- 'wansoft'
  orders INTEGER NOT NULL,
  guests INTEGER,                           -- people seated in the restaurant ("# Personas", En Restaurante)
  net_minor INTEGER NOT NULL,               -- without IVA, after discounts and courtesies
  total_minor INTEGER NOT NULL,             -- IVA included
  dine_in_net_minor INTEGER NOT NULL DEFAULT 0,
  tips_minor INTEGER NOT NULL DEFAULT 0,
  discounts_minor INTEGER NOT NULL DEFAULT 0,
  loaded_at INTEGER NOT NULL
);
