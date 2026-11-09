-- Google Calendar link (one row). refresh_token lets the Worker keep meetings in sync while the app is closed.
CREATE TABLE IF NOT EXISTS gcal (
  id INTEGER PRIMARY KEY CHECK (id = 1), email TEXT, refresh_token TEXT, access_token TEXT, access_exp INTEGER,
  sync_token TEXT, last_pull INTEGER NOT NULL DEFAULT 0, calendar_id TEXT NOT NULL DEFAULT 'primary'
);
