-- /rumbo/ opens Rumbo (Worker rumbo) through the Hub's proxy: the F&B director's initiatives, check-ins, wins and score.
-- Michael logs in it (editor); Hub admins see it through their admin role.
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('rumbo', 'Rumbo', 'hospitalidad', 'Iniciativas, logros y calificación del director de A&B', 'live', 'proxy', '', 'RUMBO', 0, 3);
INSERT OR IGNORE INTO grants (email, slug, role, granted_by, created_at) VALUES
  ('michael@dosbuhos.com', 'rumbo', 'editor', 'migration 0013', CAST(strftime('%s','now') AS INTEGER) * 1000);
