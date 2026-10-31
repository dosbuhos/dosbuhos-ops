-- Sales team CRM (Eric monitors and joins in) and the F&B director dashboard for Michael.
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('crm',          'CRM de ventas',       'ventas',       'Cuentas, oportunidades y seguimiento del equipo de ventas; Eric ve todo y participa', 'soon', 'link', '', '', 0, 5),
  ('tablero-ayb',  'Tablero de A&B',      'hospitalidad', 'Guía diaria del director de A&B: ventas, costos, equipo, pendientes y metas',        'soon', 'link', '', '', 0, 5);
