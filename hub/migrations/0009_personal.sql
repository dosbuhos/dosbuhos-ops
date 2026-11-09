-- Personal para eventos: staffing calculator served by the cotizador Worker through the Hub (Google sign-in, no PIN).
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('personal', 'Personal para eventos', 'ventas', 'Plantilla por evento, internos y externos, costo y reparto del fee de servicio', 'live', 'proxy', '', 'COTIZADOR', 0, 55);
