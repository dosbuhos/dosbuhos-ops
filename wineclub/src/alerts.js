// Avisos: everything that needs a person's attention but isn't a box to hand over.
// Collected in one place (bell in the top bar) instead of stacked on top of the work screens.
import { esc, page } from './ui.js';
import { allOccurrences } from './data.js';
import { billingIssues } from './billing.js';
import { addDays } from './schedule.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function buildAlerts(ctx, user) {
  const today = ctx.today;
  const { occ, unmapped } = allOccurrences(ctx, addDays(today, 31));
  const out = [];
  const blocked = occ.filter(o => o.state === 'payment_blocked');
  if (blocked.length) out.push({ tone: 'red', title: `${plural(blocked.length, 'caja bloqueada', 'cajas bloqueadas')} por pago`, text: 'No entregar hasta confirmar el pago en Stripe.', href: '/envios?f=cobro' });
  for (const i of billingIssues(ctx)) out.push({ tone: i.tone === 'red' ? 'red' : 'amber', title: `${i.sub.member_name}: ${i.title}`, text: i.detail, href: `/socio/${i.sub.member_id}#membresia` });
  if (unmapped.length) out.push({ tone: 'red', title: `${plural(unmapped.length, 'socio', 'socios')} sin club asignado`, text: `Sus envíos no se calculan hasta asignar el club en Stripe: ${unmapped.map(s => s.member_name).join(', ')}.`, href: user.isManager ? '/conciliar' : '/socios?f=todos' });
  const due = occ.filter(o => o.state === 'held' && o.holdReleaseDue);
  if (due.length) out.push({ tone: 'amber', title: `${plural(due.length, 'resguardo', 'resguardos')} con fecha cumplida`, text: 'Coordinar retiro o envío con el socio.', href: '/envios?f=resguardo' });
  const sync = ctx.settings.last_sync ? JSON.parse(ctx.settings.last_sync) : null;
  if (user.isManager && sync && !sync.ok) out.push({ tone: 'amber', title: 'Stripe no se sincronizó', text: sync.error || 'La última sincronización falló.', href: '/ajustes' });
  return out;
}

export function alertsPage({ env, user, ctx }) {
  const list = buildAlerts(ctx, user);
  const red = list.filter(a => a.tone === 'red'), amber = list.filter(a => a.tone !== 'red');
  const item = (a) => `<a class="avi ${a.tone}" href="${esc(a.href)}"><b>${esc(a.title)}</b><span>${esc(a.text)}</span></a>`;
  const body = `
  <h1>Avisos</h1>
  ${list.length ? `${red.length ? `<h2 class="qh">Importante <span class="n">${red.length}</span></h2>${red.map(item).join('')}` : ''}
    ${amber.length ? `<h2 class="qh">Para revisar <span class="n">${amber.length}</span></h2>${amber.map(item).join('')}` : ''}`
    : '<div class="card empty"><b>Sin avisos.</b><br>Todo sincronizado y sin pagos pendientes.</div>'}
  <p class="small muted">Los avisos se actualizan solos cuando se resuelve el problema.</p>
  <style>.avi{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:12px;margin:8px 0;text-decoration:none;min-height:56px}
  .avi.red{background:var(--red-soft);color:var(--red)}.avi.amber{background:var(--amber-soft);color:var(--amber)}.avi span{font-size:14px;color:var(--ink)}
  .qh{display:flex;align-items:baseline;gap:8px;font-size:15px;font-weight:800;margin:18px 0 6px}.qh .n{font-size:13px;color:var(--muted)}</style>`;
  return page({ title: 'Avisos', body, user, env, alerts: list.length, alertsRed: red.length });
}
