-- Access tokens for the MCP endpoint (assistants such as Claude or ChatGPT). Only the SHA-256 of a token is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_used INTEGER
);
