-- Sign-in with a username (Eric, 25 Nov 2026): an administrator creates each person with a username, their WhatsApp
-- (still required: the app depends on it) and a temporary password, which they replace the first time they enter.
ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username COLLATE NOCASE);
