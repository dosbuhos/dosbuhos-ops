// Club de beneficios: pure rules, no I/O. Shared by the Worker (src/club.js, src/club-public.js, src/club-wineclub.js)
// and the tests. Scope: CLUB-SCOPE.md.
//
// Model in one paragraph: programs are columns (kind 'compras' = Nivel 1/2/3 by rolling 12-month spend, 'invitacion' =
// Novios, Empleados, Amigos y familia, Profesionales 1/2/3, 'fundadores'), benefits are rows, a cell says what a program
// gets. A person can be in several programs; per benefit the best value applies (no stacking) and staff see which
// program it comes from. Everyone who buys is at least Nivel 1.

export const TZ = 'America/Mexico_City';
export const UNDO_MS = 10 * 60 * 1000;
export const DAY_MS = 86400e3;
export const KINDS = ['percent', 'count_per_year', 'yes_no', 'amount', 'text'];
export const APPLIES = ['restaurante', 'tienda', 'experiencias', 'eventos'];
export const PROGRAM_KINDS = ['compras', 'invitacion', 'fundadores'];
export const CHANNELS = { restaurante: 'Restaurante', tienda: 'Tienda', en_linea: 'En línea', experiencias: 'Experiencias', punto_externo: 'Punto de venta externo', suscripcion: 'Suscripción' };
export const PRO_TYPES = { tour_operador: 'Tour operador', wedding_planner: 'Wedding planner', organizador_eventos: 'Organizador de eventos', concierge: 'Concierge', distribuidor: 'Distribuidor', cliente: 'Cliente' };
// Wine club subscription states that still count as a member (Stripe status or the app's manual states).
export const ACTIVE_WC = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'manual']);

export const today = (now = Date.now()) => new Date(now).toLocaleDateString('en-CA', { timeZone: TZ });
export const nowHM = (now = Date.now()) => new Date(now).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
export const yearStart = day => String(day).slice(0, 4) + '-01-01';
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A long random token: card codes and invite tokens. 18 bytes = 144 bits = 24 base64url characters. The card code is the
// guest's only credential, so it is never derived from anything guessable.
export function token(bytes = 18) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const CODE_RE = /^[A-Za-z0-9_-]{20,64}$/;

// Phone → digits with country code. 10 digits = Mexico (52). Old Mexican mobile prefix 521 → 52. Others as typed.
export function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10) return '52' + d;
  if (d.length === 13 && d.startsWith('521')) return '52' + d.slice(3);
  return d;
}
export function fmtPhone(d) {
  d = String(d || '');
  if (d.length === 12 && d.startsWith('52')) return `+52 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  if (d.length === 11 && d.startsWith('1')) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return d ? '+' + d : '';
}
export const validPhone = d => /^\d{10,15}$/.test(d);
export const normEmail = v => { const e = String(v || '').trim().toLowerCase(); return /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(e) ? e : ''; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
export const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';

// Can this invite still be used? null when it can, otherwise the reason in the guest's words.
export function inviteProblem(inv, now = Date.now()) {
  if (!inv) return 'Esta invitación no existe. Pide a quien te la mandó un enlace nuevo.';
  if (inv.revoked_at) return 'Esta invitación ya no está activa. Pide a quien te la mandó un enlace nuevo.';
  if (inv.program_archived) return 'Este programa ya no recibe socios nuevos.';
  if (inv.expires_at && now > inv.expires_at) return 'Esta invitación ya venció. Pide a quien te la mandó un enlace nuevo.';
  if (inv.max_uses && inv.uses >= inv.max_uses) return 'Esta invitación ya se usó. Pide a quien te la mandó un enlace nuevo.';
  return null;
}

// ---------- levels by purchases ----------
const compras = programs => programs.filter(p => p.kind === 'compras' && !p.archived).sort((a, b) => (a.threshold_mxn ?? 0) - (b.threshold_mxn ?? 0));

// The purchase level the spend reaches (Nivel 1 from the first peso), or null when there is no purchase level.
export function levelFromSpend(spend, programs) {
  let hit = null;
  for (const p of compras(programs)) if ((Number(spend) || 0) >= (p.threshold_mxn ?? 0)) hit = p;
  return hit;
}
// "Te faltan $X para Nivel 2". null at the top level.
export function nextLevel(spend, programs, current) {
  const ps = compras(programs);
  const i = current ? ps.findIndex(p => p.id === current.id) : -1;
  const n = ps[i + 1];
  if (!n) return null;
  return { program: n, missing: Math.max(0, Math.ceil((n.threshold_mxn ?? 0) - (Number(spend) || 0))) };
}

// Which programs a person is in right now.
//   memberships: [{program_id, status, source}] (purchase-level rows with status 'active' are manual floors set by a manager)
//   spend: rolling 12-month spend that counts (visits + approved receipts + subscription charges)
// Everyone who buys is at least Nivel 1; a person with no other active program also shows Nivel 1 (they joined through a
// purchase link). Only one purchase level applies: the higher of spend and a manual floor.
// commitment: the annual commitment of an active Círculo subscription (price × periods per year). The level is set by the
// higher of spend and commitment; bySubscription says the commitment is what set it ("Nivel 2 · por tu suscripción").
export function effectivePrograms({ programs, memberships, spend = 0, commitment = 0 }) {
  const P = new Map(programs.map(p => [p.id, p]));
  const act = memberships.filter(m => m.status === 'active').map(m => P.get(m.program_id)).filter(p => p && !p.archived);
  const invites = act.filter(p => p.kind !== 'compras');
  const basis = Math.max(Number(spend) || 0, Number(commitment) || 0);
  let level = (basis > 0 || !invites.length) ? (levelFromSpend(basis, programs) || compras(programs)[0] || null) : null;
  let bySubscription = !!level && commitment > spend && levelFromSpend(spend, programs)?.id !== level.id;
  let manual = false;
  for (const f of act.filter(p => p.kind === 'compras')) {
    if (!level || (f.threshold_mxn ?? 0) > (level.threshold_mxn ?? 0)) { level = f; manual = true; bySubscription = false; }
  }
  // A person whose only rows are pending (waiting for approval) is not in any program yet.
  if (!act.length && memberships.some(m => m.status === 'pending')) { level = null; bySubscription = false; }
  const list = [...new Map([...invites, ...(level ? [level] : [])].map(p => [p.id, p])).values()].sort((a, b) => a.sort - b.sort);
  return { programs: list, level, manualLevel: manual, bySubscription, basis };
}

// ---------- the heart: what applies ----------
// For each benefit, the best value among the person's programs whose cell is on (no stacking), where it comes from, and
// what the other programs would have given. Count benefits carry used/left for the calendar year.
//   programs: the person's effective programs; benefits; cells: [{program_id, benefit_id, enabled, value, text_value, max_guests, note, confirmed}]
//   used: {benefit_id: qty used this year}
export function resolve({ programs, benefits, cells, used = {} }) {
  const cellOf = new Map(cells.map(c => [c.program_id + '|' + c.benefit_id, c]));
  const out = [];
  for (const b of benefits.filter(b => !b.archived).sort((a, c) => a.sort - c.sort)) {
    const offers = [];
    for (const p of programs) {
      const c = cellOf.get(p.id + '|' + b.id);
      if (!c || !c.enabled) continue;
      if (b.kind === 'text') { if (!String(c.text_value || '').trim()) continue; }
      else if (b.kind !== 'yes_no' && !(Number(c.value) > 0)) continue;
      offers.push({ program_id: p.id, program: p.name, color: p.color, sort: p.sort,
        value: b.kind === 'yes_no' || b.kind === 'text' ? null : Number(c.value), text: b.kind === 'text' ? String(c.text_value).trim() : '',
        max_guests: c.max_guests ?? null, note: c.note || '', confirmed: !!c.confirmed });
    }
    if (!offers.length) continue;
    // Best value wins; on a tie, more guests covered, then the program listed first.
    offers.sort((x, y) => (y.value ?? 0) - (x.value ?? 0) || (y.max_guests ?? -1) - (x.max_guests ?? -1) || x.sort - y.sort);
    const best = offers[0];
    const r = { benefit_id: b.id, name: b.name, kind: b.kind, unit: b.unit, applies_to: b.applies_to, rules: b.rules, phrase: b.phrase,
      value: best.value, text: best.text, max_guests: best.max_guests, note: best.note, confirmed: best.confirmed,
      program_id: best.program_id, program: best.program, color: best.color,
      others: offers.slice(1).map(o => ({ program: o.program, value: o.value, text: o.text })) };
    if (b.kind === 'count_per_year') { r.used = Number(used[b.id] || 0); r.left = Math.max(0, best.value - r.used); }
    out.push(r);
  }
  return out;
}

const fmtV = (v, kind) => kind === 'amount' ? money(v) : String(Math.round(Number(v) * 100) / 100);

// What the guest reads, in plain words: "10% de descuento en toda tu cuenta del restaurante".
export function guestPhrase(r) {
  const t = (r.phrase || r.name);
  return t.replace('{v}', fmtV(r.value, r.kind)).replace('{t}', r.text || '');
}
export function guestDetail(r) {
  const bits = [];
  if (r.max_guests != null && r.applies_to === 'restaurante' && r.kind === 'percent') bits.push(r.max_guests ? `Tú presente, con hasta ${r.max_guests} acompañantes` : 'Solo para ti');
  if (r.kind === 'count_per_year') bits.push(r.left > 0 ? `Te quedan ${r.left} de ${fmtV(r.value)} este año` : `Ya usaste los ${fmtV(r.value)} de este año`);
  return bits.join(' · ');
}
// What staff read where they apply it: "10% sobre toda la cuenta · socio presente · hasta 4 acompañantes · …".
export function staffHead(r) {
  if (r.kind === 'yes_no') return r.name;
  if (r.kind === 'text') return r.text;
  if (r.kind === 'count_per_year') return `${fmtV(r.value)} ${r.unit || ''} al año · quedan ${r.left}`.replace(/\s+/g, ' ');
  if (r.kind === 'percent' && r.applies_to === 'restaurante') return `${fmtV(r.value)}% sobre toda la cuenta`;
  if (r.kind === 'percent') return `${fmtV(r.value)}% · ${r.name.replace(/^Descuento (en|sobre) /i, '').replace(' — ', ' · ')}`;
  return `${fmtV(r.value, r.kind)} · ${r.name}`;
}
export function staffRule(r) {
  let rules = String(r.rules || '');
  rules = r.max_guests != null ? rules.replace('{g}', String(r.max_guests)) : rules.split(' · ').filter(s => !s.includes('{g}')).join(' · ');
  return [rules, r.note].filter(Boolean).join(' · ');
}
// The OpenTable guest note: "Amigos y familia Dos Búhos · 10% cuenta · VIP".
export function openTableNote(person, resolved, programs) {
  const r = resolved.find(x => x.applies_to === 'restaurante' && x.kind === 'percent');
  const main = programs[0];
  const label = main ? (main.short_label || main.name) : 'Club';
  return `${label} Dos Búhos${r ? ` · ${fmtV(r.value)}% cuenta` : ''}${person.vip || programs.some(p => p.vip) ? ' · VIP' : ''}`;
}
export const suggestDiscount = (pct, total) => Math.round((Number(pct) || 0) * (Number(total) || 0)) / 100;

// Professionals: milestone flags every N people brought (default 200).
export function milestones(people, every = 200) {
  every = Math.max(1, Number(every) || 200);
  const reached = Math.floor((Number(people) || 0) / every);
  return { reached, last: reached * every, next: (reached + 1) * every, toNext: (reached + 1) * every - (Number(people) || 0) };
}

// ---------- the wine club ----------
// Wine club rows → club people and their subscription spend. One row per (member, subscription, fulfillment-or-null).
//   members: [{id, name, email, phone, merged_into, suspended_on}]
//   subs: [{id, member_id, status, ended_on, price_amount, club_name}]
//   fulfillments: [{subscription_id, k, status, paid_on, paid_amount, done_on}]
// Returns [{member_id, name, email, phone, founder, active, charges: [{key, day, amount, estimated}]}].
// Amounts in the wine club are in cents. A paid fulfillment with no amount is estimated at the subscription price; a
// shipment handed over with no payment recorded is estimated the same way (legacy imports). Merged members are skipped.
export function mapWineclub({ members, subs, fulfillments }, day = today()) {
  const since = addDays(day, -365);
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const byMember = new Map();
  for (const m of members) {
    if (m.merged_into) continue;
    byMember.set(m.id, { member_id: m.id, name: String(m.name || '').trim(), email: normEmail(m.email), phone: normPhone(m.phone), founder: false, active: false, commitment: 0, suspended: !!m.suspended_on, charges: [] });
  }
  const subById = new Map();
  for (const s of subs) {
    const m = byMember.get(s.member_id); if (!m) continue;
    subById.set(s.id, s);
    const live = ACTIVE_WC.has(String(s.status || '').toLowerCase()) && !(s.ended_on && s.ended_on <= day) && !m.suspended;
    if (live) {
      m.active = true;
      // Annual commitment: price × periods per year (Stripe interval first, the club's cadence otherwise).
      const per = s.billing_interval === 'year' ? 1 / (s.billing_interval_count || 1) : s.billing_interval === 'month' ? 12 / (s.billing_interval_count || 1)
        : s.cadence_months ? 12 / s.cadence_months : 0;
      if (s.price_amount != null && per) m.commitment += (s.price_amount / 100) * per;
    }
    if (live && /fundador/.test(norm(s.club_name))) m.founder = true;
  }
  for (const f of fulfillments) {
    const s = subById.get(f.subscription_id); if (!s) continue;
    const m = byMember.get(s.member_id);
    const handed = ['handed', 'shipped', 'delivered'].includes(String(f.status || ''));
    const d = f.paid_on || (handed ? f.done_on : null);
    if (!d || d < since || d > day) continue;
    let amount = null, estimated = false;
    if (f.paid_on && f.paid_amount != null) amount = f.paid_amount / 100;
    else if (s.price_amount != null) { amount = s.price_amount / 100; estimated = true; }
    if (amount == null || !(amount > 0)) continue;
    m.charges.push({ key: `${s.id}:${f.k}`, day: d, amount, estimated });
  }
  return [...byMember.values()].filter(m => m.active || m.charges.length);
}

// ---------- share texts, in the house voice: plain, warm, no filler ----------
export function inviteText({ name, program, url }) {
  const hi = name ? `Hola ${firstName(name)}, ` : 'Hola, ';
  return `${hi}te invito al club de Dos Búhos (${program}). Te registras aquí en un minuto: ${url}\nCon la tarjeta en tu teléfono te reconocemos en la bodega y en el restaurante. Te esperamos.`;
}
export function cardText({ name, url }) {
  return `Hola ${firstName(name)}, esta es tu tarjeta del club de Dos Búhos: ${url}\nGuárdala en la pantalla de inicio y muéstrala cuando vengas.`;
}
export const waLink = (phone, text) => `https://wa.me/${phone ? String(phone).replace(/\D/g, '') : ''}?text=${encodeURIComponent(text)}`;

// Paste for Novios: one couple per line, "Nombre, teléfono, correo, fecha de boda" (commas, tabs or semicolons).
export function parseNovios(text) {
  const rows = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const parts = line.split(/\t|;|,(?=\s*[^\s])/).map(s => s.trim());
    const name = parts[0] || '';
    let phone = '', email = '', wedding = '';
    for (const x of parts.slice(1)) {
      if (!email && normEmail(x)) email = normEmail(x);
      else if (!wedding && parseDay(x)) wedding = parseDay(x);
      else if (!phone && /\d{7,}/.test(x.replace(/\D/g, '') ) && x.replace(/\D/g, '').length >= 10) phone = normPhone(x);
    }
    if (!name) errors.push(`Línea ${i + 1}: falta el nombre`);
    else if (!phone && !email) errors.push(`Línea ${i + 1} (${name}): falta teléfono o correo`);
    else rows.push({ name, phone, email, wedding });
  });
  return { rows, errors };
}
// 2025-05-17, 17/05/2025, 17-5-25 → YYYY-MM-DD
export function parseDay(s) {
  s = String(s || '').trim();
  if (DAY_RE.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isNaN(Date.parse(d)) ? '' : d;
}

// Colour contrast of white text on a badge colour (WCAG). Badges need 4.5:1.
export function contrastOnWhite(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return 0;
  const n = parseInt(m[1], 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 1.05 / (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] + 0.05);
}
