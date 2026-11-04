// Club de beneficios — wallet cards (Apple Wallet and Google Wallet).
// The wallet card is a copy of the web card: the member's name, programs and the same QR (the card link), so staff
// scan it exactly like the web card. Benefits and counts stay live on the web card; the wallet card lists them on its
// back as of the moment it was added.
//   GET /c/<code>/wallet/apple   → a signed .pkpass (Safari opens "Agregar a Wallet")
//   GET /c/<code>/wallet/google  → redirect to Google's "Guardar en Google Wallet" page (signed JWT)
// Each side switches on by itself once its settings exist; until then the card page shows no wallet button.
//   Apple:  vars APPLE_PASS_TYPE_ID (pass.com.dosbuhos.club), APPLE_TEAM_ID;
//           secrets APPLE_PASS_CERT (PEM certificate), APPLE_PASS_KEY (PEM private key, unencrypted PKCS#8),
//           APPLE_WWDR_CERT (PEM, Apple WWDR G4 intermediate)
//   Google: var GOOGLE_WALLET_ISSUER_ID; secrets GOOGLE_WALLET_SA_EMAIL, GOOGLE_WALLET_SA_KEY (PEM private key of the
//           service account that has access to the issuer)
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import * as C from './club-core.js';

export const appleReady = env => !!(env.APPLE_PASS_TYPE_ID && env.APPLE_TEAM_ID && env.APPLE_PASS_CERT && env.APPLE_PASS_KEY && env.APPLE_WWDR_CERT);
export const googleReady = env => !!(env.GOOGLE_WALLET_ISSUER_ID && env.GOOGLE_WALLET_SA_EMAIL && env.GOOGLE_WALLET_SA_KEY);

const enc = new TextEncoder();
const WINE = '#5a1726', CREAM = '#f6efe3', GOLD_SOFT = '#e9dcc2';
const rgb = hex => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

// What the wallet card says, in plain words. Shared by both wallets.
export function cardContent(person, st) {
  const programs = st.programs.map(p => p.name);
  const benefits = st.resolved.map(r => { const d = C.guestDetail(r); return d ? `${C.guestPhrase(r)} (${d})` : C.guestPhrase(r); });
  return {
    name: person.name,
    programs: programs.length ? programs.join(' · ') : (st.pending.length ? 'En revisión' : 'Club Dos Búhos'),
    level: st.level ? st.level.name : '',
    validUntil: st.validUntil || '',
    benefits,
    since: person.created_at ? new Date(person.created_at).toISOString().slice(0, 10) : '',
  };
}

// ---------- Apple Wallet ----------
export function passJson(env, person, content, link) {
  const back = [
    { key: 'beneficios', label: 'Tus beneficios', value: content.benefits.length ? content.benefits.map(b => '• ' + b).join('\n') : 'Los verás en tu tarjeta en línea.' },
    { key: 'tarjeta', label: 'Tu tarjeta en línea (beneficios y saldos al día)', value: link, attributedValue: `<a href="${link}">Abrir mi tarjeta</a>` },
    { key: 'como', label: 'Cómo usarla', value: 'Muestra el código al llegar. El equipo lo escanea y aplica tus beneficios.' },
    { key: 'contacto', label: 'Dos Búhos', value: 'Bodega · Restaurante · San Miguel de Allende\nWhatsApp +52 415 124 7583' },
  ];
  return {
    formatVersion: 1,
    passTypeIdentifier: env.APPLE_PASS_TYPE_ID,
    teamIdentifier: env.APPLE_TEAM_ID,
    serialNumber: `club-${person.id}`,
    organizationName: 'Bodega Dos Búhos',
    description: 'Tarjeta del Club Dos Búhos',
    logoText: 'Dos Búhos',
    backgroundColor: rgb(WINE), foregroundColor: rgb(CREAM), labelColor: rgb(GOLD_SOFT),
    barcodes: [{ format: 'PKBarcodeFormatQR', message: link, messageEncoding: 'iso-8859-1', altText: 'Club Dos Búhos' }],
    storeCard: {
      primaryFields: [{ key: 'nombre', label: 'Socio', value: content.name }],
      secondaryFields: [{ key: 'programa', label: 'Programa', value: content.programs }],
      auxiliaryFields: [...(content.level ? [{ key: 'nivel', label: 'Nivel', value: content.level }] : []), ...(content.validUntil ? [{ key: 'vigencia', label: 'Vigente hasta', value: content.validUntil + 'T12:00:00-06:00', dateStyle: 'PKDateStyleMedium' }] : [])],
      backFields: back,
    },
  };
}

// A .pkpass is a plain ZIP: pass.json, images, manifest.json (SHA-1 of every file) and signature (detached CMS over
// manifest.json, signed with the pass certificate, WWDR intermediate included).
export async function buildPkpass(env, files) {
  const manifest = {};
  for (const [name, bytes] of Object.entries(files)) manifest[name] = hex(await crypto.subtle.digest('SHA-1', bytes));
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  const signature = await cmsSign(manifestBytes, env.APPLE_PASS_CERT, env.APPLE_PASS_KEY, env.APPLE_WWDR_CERT);
  return zipStore({ ...files, 'manifest.json': manifestBytes, signature });
}

async function applePass(env, person, content, link, assetBytes) {
  const json = enc.encode(JSON.stringify(passJson(env, person, content, link)));
  const icon = await assetBytes('/icon-192.png');
  const files = { 'pass.json': json, 'icon.png': icon, 'icon@2x.png': icon, 'logo.png': icon, 'logo@2x.png': icon };
  const body = await buildPkpass(env, files);
  return new Response(body, { headers: { 'content-type': 'application/vnd.apple.pkpass', 'content-disposition': 'attachment; filename="DosBuhos-Club.pkpass"', 'cache-control': 'no-store' } });
}

// ---------- Google Wallet ----------
export function googlePayload(env, person, content, link, origin) {
  const issuer = env.GOOGLE_WALLET_ISSUER_ID;
  const classId = `${issuer}.dosbuhos_club`;
  const lang = v => ({ defaultValue: { language: 'es-MX', value: v } });
  const modules = [...(content.level ? [{ id: 'nivel', header: 'Nivel', body: content.level }] : []), ...(content.validUntil ? [{ id: 'vigencia', header: 'Vigente hasta', body: content.validUntil }] : [])];
  // No benefits list here: the save link must stay short (Google advises under ~1,800 characters), and the live list
  // is one tap away through the link module.
  return {
    genericClasses: [{ id: classId }],
    genericObjects: [{
      id: `${issuer}.club_${person.id}`,
      classId,
      state: 'ACTIVE',
      cardTitle: lang('Club Dos Búhos'),
      header: lang(content.name),
      subheader: lang(content.programs),
      hexBackgroundColor: WINE,
      logo: { sourceUri: { uri: `${origin}/icon-192.png` } },
      barcode: { type: 'QR_CODE', value: link },
      ...(modules.length ? { textModulesData: modules } : {}),
      linksModuleData: { uris: [{ uri: link, description: 'Mis beneficios al día', id: 'tarjeta' }] },
    }],
  };
}

export async function googleSaveUrl(env, person, content, link, origin) {
  const claims = { iss: env.GOOGLE_WALLET_SA_EMAIL, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000), payload: googlePayload(env, person, content, link, origin) };
  return 'https://pay.google.com/gp/v/save/' + await jwtRS256(claims, env.GOOGLE_WALLET_SA_KEY);
}

// ---------- route ----------
// which: 'apple' | 'google'. personState comes from club-data (passed in to keep this module free of D1).
export async function walletRoute(env, which, person, st, link, origin, assetBytes) {
  if (person.status !== 'active') return null;
  const content = cardContent(person, st);
  if (which === 'apple' && appleReady(env)) return applePass(env, person, content, link, assetBytes);
  if (which === 'google' && googleReady(env)) return Response.redirect(await googleSaveUrl(env, person, content, link, origin), 302);
  return null;
}

// The buttons for the card page. Apple first on iPhone, Google first elsewhere; only the ones that are set up.
export function walletButtons(env, code, ua = '') {
  const a = appleReady(env), g = googleReady(env);
  if (!a && !g) return '';
  const ios = /iPhone|iPad|iPod|Macintosh/.test(ua);
  const apple = a ? `<a class="btn wallet apple" href="/c/${C.esc(code)}/wallet/apple">Agregar a Apple Wallet</a>` : '';
  const google = g ? `<a class="btn wallet google" href="/c/${C.esc(code)}/wallet/google" rel="noopener">Guardar en Google Wallet</a>` : '';
  return `<section class="wallet-btns" aria-label="Guardar la tarjeta">${ios ? apple + google : google + apple}<p class="small" style="text-align:center;margin-top:8px">Es la misma tarjeta con el mismo código. Tus beneficios al día siempre están aquí.</p></section>`;
}

// ---------- crypto helpers ----------
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function pemBytes(pem, label) {
  const s = String(pem).replace(/\\n/g, '\n');
  const m = s.match(new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`));
  if (!m) throw new Error(`PEM ${label} not found`);
  const bin = atob(m[1].replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const importKey = (pem, usage = ['sign']) => crypto.subtle.importKey('pkcs8', pemBytes(pem, 'PRIVATE KEY'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, usage);

async function jwtRS256(claims, keyPem) {
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(keyPem), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

const certFrom = pem => pkijs.Certificate.fromBER(pemBytes(pem, 'CERTIFICATE'));

// Detached CMS SignedData (SHA-256, RSA), signed attributes contentType + signingTime + messageDigest, as Apple wants.
export async function cmsSign(data, certPem, keyPem, wwdrPem) {
  const engine = new pkijs.CryptoEngine({ name: 'webcrypto', crypto, subtle: crypto.subtle });
  pkijs.setEngine('webcrypto', engine);
  const cert = certFrom(certPem), wwdr = certFrom(wwdrPem);
  const key = await importKey(keyPem);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const signed = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    signerInfos: [new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })] }),
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.5', values: [new asn1js.UTCTime({ valueDate: new Date() })] }),
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: digest })] }),
      ] }),
    })],
    certificates: [cert, wwdr],
  });
  await signed.sign(key, 0, 'SHA-256', data);
  const ci = new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: signed.toSchema(true) });
  return new Uint8Array(ci.toSchema().toBER(false));
}

// ---------- ZIP (stored, no compression: the files are tiny and PNGs are compressed already) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, raw] of Object.entries(files)) {
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const nm = enc.encode(name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
