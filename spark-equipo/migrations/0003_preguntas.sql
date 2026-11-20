-- Open questions for the team: Eric (or Claude, on his behalf) asks, the person answers inside Spark.
CREATE TABLE preguntas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  para       TEXT NOT NULL,            -- José Luis | Carlos | Daniel
  texto      TEXT NOT NULL,
  creada     TEXT NOT NULL,            -- ISO date
  creada_por TEXT NOT NULL DEFAULT '',
  respuesta  TEXT NOT NULL DEFAULT '',
  respondio  TEXT NOT NULL DEFAULT '', -- email
  respondida TEXT NOT NULL DEFAULT ''  -- ISO date; empty = still open
);
INSERT INTO preguntas (para, texto, creada, creada_por) VALUES
  ('José Luis', 'En Zoho tienes $920 mil en pedidos a nombre de "PUBLICO EN GENERAL JOSE LUIS" desde 2024. ¿Qué clientes reales hay ahí adentro? Dinos cuáles son los principales para darlos de alta con su nombre, y qué parte son muestras o consumo interno.', '2026-11-20', 'Eric'),
  ('Carlos', 'En Zoho hay $135 mil en pedidos a nombre de "Publico en general Carlos Tapia" desde septiembre de 2025. ¿Son ventas reales o muestras? Si son ventas, ¿de qué clientes?', '2026-11-20', 'Eric');
