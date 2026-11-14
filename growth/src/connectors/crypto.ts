// Authenticated encryption for dynamic secrets (OAuth refresh tokens) stored in D1. AES-256-GCM with a versioned key
// from Worker secrets (TOKEN_ENCRYPTION_KEY_V1, _V2 …). The connection ID and key version are bound as associated
// data, so a ciphertext copied onto another connection fails to decrypt (no cross-account binding mistakes).
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const enc = new TextEncoder();

async function key(raw: string): Promise<CryptoKey> {
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error('Encryption key must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface Sealed { keyVersion: number; ivB64: string; ciphertextB64: string }

export async function seal(plaintext: string, connectionId: string, keyVersion: number, keyB64: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${connectionId}|v${keyVersion}`) }, await key(keyB64), enc.encode(plaintext));
  return { keyVersion, ivB64: b64(iv), ciphertextB64: b64(new Uint8Array(ct)) };
}

export async function open(s: Sealed, connectionId: string, keyB64: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.ivB64), additionalData: enc.encode(`${connectionId}|v${s.keyVersion}`) }, await key(keyB64), unb64(s.ciphertextB64));
  return new TextDecoder().decode(pt);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison for equal-length hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Classify an OAuth refresh failure: only invalid_grant / revoked means "reconnect"; others are transient. */
export function classifyRefreshError(status: number, body: { error?: string }): 'reconnect' | 'transient' {
  if (status === 400 && (body.error === 'invalid_grant' || body.error === 'unauthorized_client')) return 'reconnect';
  if (status === 401) return 'reconnect';
  return 'transient';
}
