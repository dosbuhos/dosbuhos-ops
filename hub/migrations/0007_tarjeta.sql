-- Tarjeta QR · link tree (card Worker): public mini site + team QR cards
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('tarjeta', 'Tarjeta QR · link tree', 'marketing', 'Tarjetas QR del equipo y el mini sitio: visitas, reservas, eventos, vinos, premios, kit de prensa', 'live', 'link', 'https://card.dos-buhos.workers.dev', '', 1, 15);
UPDATE apps SET status = 'live', url = 'https://card.dos-buhos.workers.dev/press/' WHERE slug = 'marca' AND url = '';
