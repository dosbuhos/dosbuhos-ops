// The Hub's session secret lives once in the account Secrets Store (secret HUB_SESSION_SECRET, binding of the same name):
// the Hub signs with it and every app behind the Hub checks the signature with it, so no app needs its own pasted copy.
// Returns env with HUB_SECRET taken from the store; when the binding is absent or unreadable (local dev, tests) env is returned
// as it is and a plain HUB_SECRET secret, if any, still applies.
let cached;
export async function withHubSecret(env) {
  const b = env.HUB_SESSION_SECRET;
  if (!b || typeof b.get !== 'function') return env;
  if (!cached) { try { cached = await b.get(); } catch (e) { console.log('secrets store: HUB_SESSION_SECRET', String(e)); } }
  if (!cached) return env;
  return Object.defineProperty(Object.create(env), 'HUB_SECRET', { value: cached, enumerable: true });
}
