-- Monthly AI visibility check: fixed traveler questions asked to an AI assistant with web search; records whether
-- Dos Búhos is mentioned, where in the answer, how it is described, and which websites were cited.
CREATE TABLE ai_visibility_questions (
  id TEXT PRIMARY KEY,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'es')),
  question TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ai_visibility_results (
  run_key TEXT NOT NULL,              -- ai_visibility:YYYY-MM (or manual:<ms>)
  question_id TEXT NOT NULL REFERENCES ai_visibility_questions(id),
  assistant TEXT NOT NULL,            -- model id
  mentioned INTEGER NOT NULL,         -- 1 if the answer names Dos Búhos
  rank INTEGER,                       -- position among listed recommendations (1 = first), NULL if not in a list
  excerpt TEXT NOT NULL DEFAULT '',   -- the sentence that mentions Dos Búhos (or the first lines if not mentioned)
  answer TEXT NOT NULL DEFAULT '',    -- full answer, trimmed
  cited_json TEXT NOT NULL DEFAULT '[]',   -- cited URLs
  dosbuhos_cited INTEGER NOT NULL DEFAULT 0,
  searches INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (run_key, question_id, assistant)
);
INSERT INTO ai_visibility_questions (id, lang, question, sort) VALUES
  ('en_best_wineries', 'en', 'What are the best wineries to visit near San Miguel de Allende?', 1),
  ('en_tasting_lunch', 'en', 'Where can I do a wine tasting with lunch in San Miguel de Allende?', 2),
  ('en_organic', 'en', 'Is there an organic winery near San Miguel de Allende?', 3),
  ('en_vineyard_tour', 'en', 'What is the best vineyard tour in Guanajuato, Mexico for a couple?', 4),
  ('en_special_lunch', 'en', 'Where should we go for a special long lunch outside San Miguel de Allende?', 5),
  ('es_mejores_vinedos', 'es', '¿Cuáles son los mejores viñedos para visitar en San Miguel de Allende?', 6),
  ('es_cata_comida', 'es', '¿Dónde puedo hacer una cata de vinos con comida en San Miguel de Allende?', 7),
  ('es_organico', 'es', '¿Hay algún viñedo orgánico cerca de San Miguel de Allende?', 8),
  ('es_recorrido', 'es', '¿Qué recorrido por viñedos en Guanajuato me recomiendas para un fin de semana?', 9),
  ('es_restaurante_vinedo', 'es', '¿Qué restaurante en un viñedo me recomiendas en San Miguel de Allende?', 10);
