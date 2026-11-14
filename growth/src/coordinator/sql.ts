// Minimal synchronous SQL surface shared by the Durable Object's SQLite storage and the Node test harness.
export interface SqlStore {
  all<T = Record<string, unknown>>(query: string, ...binds: unknown[]): T[];
  run(query: string, ...binds: unknown[]): void;
  /** Runs fn atomically: either every statement inside commits or none does. */
  tx<T>(fn: () => T): T;
}

export const one = <T>(rows: T[]): T | undefined => rows[0];

export const COORDINATOR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS policy_versions (version INTEGER PRIMARY KEY, json TEXT NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS actions (
     id TEXT PRIMARY KEY, idem_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL, action_type TEXT NOT NULL, actor TEXT NOT NULL,
     intent TEXT NOT NULL, decision TEXT NOT NULL, approval_hash TEXT NOT NULL, approved_by TEXT, approved_at INTEGER,
     expires_at INTEGER NOT NULL, policy_version INTEGER NOT NULL, before_state TEXT, op_results TEXT NOT NULL DEFAULT '[]',
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS actions_state ON actions(state)`,
  `CREATE TABLE IF NOT EXISTS action_events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, action_id TEXT NOT NULL, from_state TEXT,
     to_state TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '{}')`,
  `CREATE INDEX IF NOT EXISTS action_events_action ON action_events(action_id, seq)`,
  `CREATE TABLE IF NOT EXISTS outbox (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL, acked_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS reservations (resource_key TEXT PRIMARY KEY, action_id TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS budget_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, budget_id TEXT NOT NULL, at INTEGER NOT NULL, from_micros INTEGER NOT NULL, to_micros INTEGER NOT NULL, source TEXT NOT NULL, action_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS suspensions (resource_key TEXT PRIMARY KEY, reason TEXT NOT NULL, at INTEGER NOT NULL)`,
];
