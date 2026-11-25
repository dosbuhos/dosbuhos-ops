-- /arqueo/ opens Arqueo (Worker arqueo) through the Hub's proxy: the physical count of Almacén 1 against Zoho.
-- Whoever pulls bottles for an orden de venta counts the whole SKU in the app; the differences become a list
-- administración captures in Zoho. Arqueo reads Zoho through the Muestras Worker and never writes to it.
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('arqueo', 'Arqueo', 'ventas', 'Conteo del almacén al surtir, y conciliación contra Zoho', 'live', 'proxy', '', 'ARQUEO', 0, 25);
