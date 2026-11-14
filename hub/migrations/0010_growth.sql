-- Growth Terminal: its own Worker (growth), opened only through the Hub at /growth/ (Google sign-in, signed X-DB-User).
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('growth', 'Growth Terminal', 'marketing', 'Anuncios y reservaciones: gasto, resultados, revisiones y propuestas', 'live', 'proxy', '', 'GROWTH', 0, 12);
