-- Acceso por enlace (WhatsApp) o correo; el PIN queda como respaldo opcional
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN last_seen TEXT;
CREATE UNIQUE INDEX idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE TABLE login_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT,                  -- código de 6 dígitos (solo enlaces por correo)
  via TEXT NOT NULL DEFAULT 'link',-- 'link' | 'email'
  expires_at INTEGER NOT NULL,     -- epoch ms
  uses INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_links_user ON login_links(user_id);
