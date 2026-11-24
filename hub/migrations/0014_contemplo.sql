-- /contemplo/ opens Contemplo Studio (Worker contemplo) through the Hub's proxy: video library, Google TV players and live show.
-- New section for Contemplo. Hub admins see it through their admin role; grant others in Admin → People.
INSERT OR IGNORE INTO sections (slug, name, sort) VALUES ('contemplo', 'Contemplo', 35);
INSERT OR IGNORE INTO apps (slug, name, section, description, status, mode, url, binding, public, sort) VALUES
  ('contemplo', 'Contemplo Studio', 'contemplo', 'Videos, pantallas y control en vivo de la proyección', 'live', 'proxy', '', 'CONTEMPLO', 0, 1);
