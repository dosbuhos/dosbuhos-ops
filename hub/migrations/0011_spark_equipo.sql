-- /spark/ now opens Spark Equipo (the sales team's numbers, Worker spark-equipo) through the Hub's proxy.
-- The earlier Spark CRM keeps its own address as "Sparks (beta)", with the same people who could open it before.
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('spark-beta', 'Sparks (beta)', 'ventas', 'CRM automatizado en pruebas: contactos y seguimiento con compradores', 'live', 'link', 'https://spark.dos-buhos.workers.dev', '', 0, 21);
INSERT OR IGNORE INTO grants (email, slug, role, granted_by, created_at)
  SELECT email, 'spark-beta', role, 'migration 0011', CAST(strftime('%s','now') AS INTEGER) * 1000 FROM grants WHERE slug = 'spark';
UPDATE apps SET name = 'Spark', description = 'Tus números de ventas: contactos de la semana, seguimientos, ventas y clientes', mode = 'proxy', url = '', binding = 'SPARK_EQUIPO' WHERE slug = 'spark';
