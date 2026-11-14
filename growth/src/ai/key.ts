// The Anthropic key can be a plain Worker secret (string) or a binding from the account Secrets Store (object with
// get()), the way the cotizador binds the shared ANTHROPIC_API_KEY. Never logged or returned to the client.
export type SecretLike = string | { get(): Promise<string> } | undefined;

export async function readSecret(v: SecretLike): Promise<string | null> {
  if (!v) return null;
  if (typeof v === 'string') return v || null;
  try { return (await v.get()) || null; } catch { return null; }
}
export const hasSecret = (v: SecretLike) => !!v;
