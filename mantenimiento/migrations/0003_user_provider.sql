-- Vincula un usuario con su ficha de responsable (para "Mías" y "Tomar")
ALTER TABLE users ADD COLUMN provider_id INTEGER REFERENCES providers(id);
