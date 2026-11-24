// Passwords for Esmero. PBKDF2-SHA-256 with a salt per person and 100 000 rounds (the most a Worker allows).
// Pure functions, used by /api/enter, /api/me/password and the one-time codes.

export const MIN_PASS = 8;
export const MAX_FAILS = 8;      // wrong passwords in a row before the account rests
export const LOCK_MIN = 15;      // minutes it rests

// The ones people try first. Not a dictionary: just enough to turn away the obvious.
const TRIVIAL = new Set(['12345678', '123456789', '1234567890', '87654321', 'password', 'password1', 'contraseña', 'contrasena',
  'qwertyui', 'qwerty123', 'abcdefgh', 'abc12345', 'dosbuhos', 'dos buhos', 'pulso123', 'pulso2026', 'bodega123']);

// '' when the password will do; otherwise the reason, in the words the person reads.
export function passProblem(pass, email = '') {
  if (typeof pass !== 'string' || pass.length < MIN_PASS) return `Elige una contraseña de al menos ${MIN_PASS} caracteres`;
  if (pass.length > 200) return 'Esa contraseña es demasiado larga';
  const p = pass.toLowerCase().trim();
  const local = String(email || '').split('@')[0].toLowerCase();
  if (TRIVIAL.has(p) || /^(.)\1+$/.test(p) || (local && p === local)) return 'Esa contraseña es muy fácil de adivinar. Elige otra.';
  return '';
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));

export async function hashPass(pass, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100000 }, key, 256);
  return toHex(bits);
}

// Compares two hex strings without stopping at the first difference.
export function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
