import { daysBetween, parse } from './schedule.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function fdate(s, today, { weekday = true } = {}) {
  if (!s) return '';
  const { y, m, d } = parse(s);
  const wd = DIA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const yr = !today || String(y) !== String(today).slice(0, 4) ? ` ${y}` : '';
  const out = `${weekday ? wd + ' ' : ''}${d} ${MES[m - 1]}${yr}`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}
export function rel(s, today) {
  const n = daysBetween(today, s);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}
export const money = (cents, cur) => cents == null ? '' : '$' + (cents / 100).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + (cur ? ' ' + cur.toUpperCase() : '');
export const cadenceLabel = (m) => ({ 1: 'mensual', 2: 'bimestral', 3: 'trimestral', 4: 'cuatrimestral', 6: 'semestral', 12: 'anual' }[m] || `cada ${m} meses`);

export const STATUS_LABEL = {
  needs_prep: 'En preparación', ready: 'Listo', held: 'En resguardo en bodega', handed: 'Entregado en mano', shipped: 'Enviado',
  delivered: 'Recibido', exception: 'Excepción', skipped: 'Omitido',
};
export const STATE = {
  payment_contact: { label: 'Contactar para nueva forma de pago', tone: 'amber' },
  payment_blocked: { label: 'Bloqueado por pago pendiente', tone: 'red' },
  suspended: { label: 'Suspendido por falta de pago', tone: 'red' },
  overdue: { label: 'Atrasado', tone: 'red' },
  today: { label: 'Hoy', tone: 'wine' },
  exception: { label: 'Excepción', tone: 'red' },
  upcoming: { label: 'Programado', tone: 'grey' },
  done: { label: 'Hecho', tone: 'green' },
  held: { label: 'En resguardo en bodega', tone: 'wine' },
  skipped: { label: 'Omitido', tone: 'grey' },
  paused: { label: 'En pausa', tone: 'grey' },
  pretracking: { label: 'Antes del registro', tone: 'grey' },
};
export function stateLabel(o) {
  if (o.state === 'done') return STATUS_LABEL[o.status];
  if (o.state === 'upcoming' && o.status && STATUS_LABEL[o.status]) return STATUS_LABEL[o.status];
  return STATE[o.state].label;
}
export const chip = (text, tone = 'grey') => `<span class="chip ${tone}">${esc(text)}</span>`;

const CSS = `
.bell{position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin-left:auto;color:#fff;flex:none}.bell svg{width:24px;height:24px}
.bell .bdg{position:absolute;top:4px;right:2px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#fff;color:var(--wine);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center}.bell .bdg.r{background:#ffd7d2;color:var(--red)}
.top .who{max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.benefit-stepper{display:flex;align-items:center;gap:12px;margin-top:12px}
.work-member{font-size:18px;font-weight:700;overflow-wrap:anywhere;text-underline-offset:3px}
.member-filters{margin-bottom:12px}
.member-filters a[aria-current="page"]{outline:2px solid currentColor;outline-offset:1px}
.shipment-work.payment_contact,.schedule-row.payment_contact{border-left:4px solid var(--amber)}
#membresia>summary{justify-content:space-between;gap:16px;list-style:none}
#membresia>summary::-webkit-details-marker{display:none}
#membresia>summary small{display:block;font-size:13px;font-weight:400;margin-top:4px}
#membresia .membership-arrow{font-size:24px;flex:none;transition:transform .15s}
#membresia[open] .membership-arrow{transform:rotate(180deg)}
.benefit-stepper button{width:48px;min-height:48px;padding:0;flex:none;font-size:26px}
.benefit-pending{flex:1;text-align:center;font-size:14px;font-weight:600}
.benefit-confirm{margin-top:10px;padding:12px;background:var(--wine-soft);border-radius:10px}
.benefit-confirm[hidden]{display:none}
.benefit-confirm p{margin:0 0 10px;overflow-wrap:anywhere}
.benefit-confirm .btn{width:100%}
:root{--ink:#1f1d1b;--muted:#6b6560;--line:#e6e0d8;--bg:#f7f4ef;--card:#fff;--wine:#6b2737;--wine-d:#521c2a;--wine-soft:#f4e8ea;
--red:#b42318;--red-soft:#fdecea;--amber:#8a5200;--amber-soft:#fdf3e1;--green:#1e6b3a;--green-soft:#e6f4ea;--grey-soft:#efebe6;--r:14px;
--nav:64px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
padding-bottom:calc(var(--nav) + env(safe-area-inset-bottom) + 12px)}
a{color:var(--wine)}
.top{background:var(--wine);color:#fff;padding:12px 16px calc(12px);padding-top:calc(12px + env(safe-area-inset-top));display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:20}
.top .brand{font-family:Georgia,"Times New Roman",serif;font-size:19px;letter-spacing:.2px;color:#fff;text-decoration:none}
.top .env{font-size:11px;font-weight:700;background:#fff3;border-radius:999px;padding:2px 8px;text-transform:uppercase;letter-spacing:.5px}
.top .who{margin-left:auto;font-size:12px;opacity:.85;max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{max-width:720px;margin:0 auto;padding:14px 14px 0}
h1{font-size:22px;margin:6px 0 10px;line-height:1.2}h2{font-size:16px;margin:22px 0 8px}h3{font-size:15px;margin:14px 0 6px}
.muted{color:var(--muted)}.small{font-size:13px}.right{text-align:right}.center{text-align:center;margin:18px 0}
.navbar{position:fixed;left:0;right:0;bottom:0;z-index:30;background:#fff;border-top:1px solid var(--line);display:flex;
padding-bottom:env(safe-area-inset-bottom)}
.navbar a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:var(--nav);text-decoration:none;color:var(--muted);font-size:12px;font-weight:600}
.navbar a svg{width:24px;height:24px}.navbar a.on{color:var(--wine)}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0 6px}
.tile{display:block;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;text-decoration:none;color:var(--ink);min-height:64px}
.tile .v{font-size:28px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}.tile .l{font-size:12px;color:var(--muted);margin-top:4px;font-weight:600}
.tile.red{background:var(--red-soft);border-color:#f3c4bf}.tile.red .v,.tile.red .l{color:var(--red)}
.tile.wine{background:var(--wine-soft);border-color:#e6cbd0}.tile.wine .v{color:var(--wine)}
.sec{position:sticky;top:calc(52px + env(safe-area-inset-top));z-index:10;background:var(--bg);margin:18px -14px 4px;padding:8px 14px;font-size:13px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);display:flex;gap:8px;align-items:baseline}
.sec.red{color:var(--red)}.sec.wine{color:var(--wine)}.sec .n{font-weight:700;letter-spacing:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px;margin:10px 0}
.ship{border-left:6px solid var(--line)}.ship.overdue,.ship.exception{border-left-color:var(--red)}.ship.today{border-left-color:var(--wine)}
.ship.done{border-left-color:var(--green)}.ship.upcoming{border-left-color:#c9bfb3}
.ship .when{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ship .date{font-size:18px;font-weight:800}.ship .rel{font-size:13px;color:var(--muted)}
.ship .when .chip{margin-left:auto}
.ship a.who{display:block;text-decoration:none;color:var(--ink);margin:6px 0 2px;padding:4px 0;min-height:44px}
.ship .name{display:block;font-size:19px;font-weight:700;line-height:1.25}
.ship .meta{display:block;color:var(--muted);font-size:14px;margin-top:2px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}
.chip{display:inline-block;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;background:var(--grey-soft);color:#4a4540;white-space:nowrap}
.chip.red{background:var(--red-soft);color:var(--red)}.chip.amber{background:var(--amber-soft);color:var(--amber)}
.chip.green{background:var(--green-soft);color:var(--green)}.chip.wine{background:var(--wine-soft);color:var(--wine)}
details.bottles{margin:10px 0 0;border:1px solid var(--line);border-radius:12px;background:#fcfbf9}
details.bottles summary{list-style:none;cursor:pointer;min-height:48px;display:flex;align-items:center;gap:8px;padding:0 14px;font-weight:700;color:var(--wine)}
details.bottles summary::-webkit-details-marker{display:none}
details.bottles summary::after{content:"▾";margin-left:auto;transition:transform .15s}details.bottles[open] summary::after{transform:rotate(180deg)}
ul.blist{list-style:none;margin:0;padding:2px 14px 12px}ul.blist li{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line);font-size:16px}
ul.blist li:first-child{border-top:0}ul.blist .q{min-width:2.4em;font-weight:800;font-variant-numeric:tabular-nums;color:var(--wine)}
.warn{background:var(--red-soft);color:var(--red);border-radius:12px;padding:12px 14px;font-weight:700;margin:10px 0 0}
.warn.amber{background:var(--amber-soft);color:var(--amber)}
.acts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.acts.one{grid-template-columns:1fr}
.btn{display:flex;align-items:center;justify-content:center;text-align:center;background:var(--wine);color:#fff;border:0;border-radius:12px;
min-height:52px;padding:10px 14px;font:inherit;font-size:16px;font-weight:700;text-decoration:none;cursor:pointer;width:100%}
.btn:active{background:var(--wine-d)}.btn.ghost{background:#fff;color:var(--wine);border:2px solid var(--wine)}
.btn.quiet{background:var(--grey-soft);color:var(--ink)}.btn.danger{background:#fff;color:var(--red);border:2px solid var(--red)}
.btn.sm{min-height:44px;font-size:15px;padding:8px 12px}.btn[disabled]{opacity:.5}
.banner{border-radius:var(--r);padding:12px 14px;margin:10px 0;font-weight:600;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.banner.green{background:var(--green-soft);color:var(--green)}.banner.red{background:var(--red-soft);color:var(--red)}.banner.amber{background:var(--amber-soft);color:var(--amber)}
.banner form{margin:0}.banner .btn{min-height:40px;width:auto;font-size:14px;padding:6px 12px}
.banner a{font-weight:700}
label{display:block;font-size:14px;font-weight:700;margin:12px 0 4px}
input,select,textarea{width:100%;font:inherit;font-size:16px;padding:11px 12px;border:1px solid #cfc6bb;border-radius:12px;background:#fff;color:var(--ink);min-height:48px}
textarea{min-height:96px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:520px){.grid2{grid-template-columns:1fr}}
.rows a.row{display:flex;gap:12px;align-items:center;padding:12px 14px;border-top:1px solid var(--line);text-decoration:none;color:var(--ink);min-height:60px}
.rows a.row:first-child{border-top:0}.rows .row .main{flex:1;min-width:0}.rows .row .t{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rows .row .s{font-size:13px;color:var(--muted)}
.rows{background:#fff;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin:10px 0}
.rows a.row[hidden]{display:none}.scroll{max-width:100%;overflow-x:auto}input[type=checkbox],input[type=radio]{accent-color:var(--wine)}
html{scroll-padding-top:100px}.grid2>*{min-width:0}.sticky-foot{z-index:15;background:var(--bg)}
.tl .row{border-left:4px solid transparent}.tl .row.overdue,.tl .row.exception{border-left-color:var(--red)}.tl .row.today{border-left-color:var(--wine)}
.tl .row.done{border-left-color:var(--green)}.tl .row .d{width:76px;flex:none;font-weight:800;font-size:14px}
@media(max-width:520px){.rows.tl a.row{display:grid;grid-template-columns:60px minmax(0,1fr);gap:4px 10px;align-items:start}
.rows.tl .row .d{width:auto;grid-column:1;grid-row:1 / span 2}.rows.tl .row .main{grid-column:2}
.rows.tl .row .chip{grid-column:2;justify-self:start;max-width:100%}.rows.tl .row .t{white-space:normal}.rows.tl .row .s{overflow-wrap:anywhere}}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}dl.kv dt{color:var(--muted);font-size:14px}dl.kv dd{margin:0;word-break:break-word}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
.scroll{overflow-x:auto}
details.more{margin:12px 0}details.more>summary{cursor:pointer;font-weight:700;color:var(--wine);min-height:44px;display:flex;align-items:center}
.meter{height:8px;background:var(--grey-soft);border-radius:999px;overflow:hidden;margin-top:6px}.meter i{display:block;height:100%;background:var(--wine)}
.ben{display:flex;gap:10px;align-items:center;justify-content:space-between}.ben .num{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.empty{text-align:center;color:var(--muted);padding:28px 10px}
.photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.photos img{width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
.search{position:sticky;top:calc(52px + env(safe-area-inset-top));z-index:10;background:var(--bg);padding:6px 0}
.eyebrow{font-size:12px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
.enrollment{border-top:4px solid var(--wine)}.enrollment-date{font:700 27px Georgia,serif;color:var(--wine);margin:6px 0}
.top .brand{white-space:nowrap;flex-shrink:0}.top .who{min-width:0}.top .env{font-size:9px;flex-shrink:0}.ship.overdue.unverified{border-left-color:var(--amber)}
.enrollment p{margin:6px 0 10px}.jump-links{display:flex;gap:8px;flex-wrap:wrap}.jump-links a{display:flex;align-items:center;min-height:44px;padding:8px 12px;background:var(--wine-soft);border-radius:10px;font-size:13px;font-weight:700;text-decoration:none}
.date-facts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.date-facts>div{min-width:0}.date-facts dt{font-size:12px;color:var(--muted)}.date-facts dd{margin:3px 0 0;font-weight:750;font-size:16px}
.schedule-list{border:1px solid var(--line);border-radius:12px;overflow:hidden}.schedule-row{display:block;color:var(--ink);text-decoration:none;padding:14px;border-left:4px solid var(--line);border-top:1px solid var(--line)}
.schedule-row:first-child{border-top:0}.schedule-row.overdue,.schedule-row.exception{border-left-color:var(--amber)}.schedule-row.done{border-left-color:var(--green)}
.schedule-top{display:flex;align-items:flex-start;gap:10px;justify-content:space-between;flex-wrap:wrap}.schedule-top>b{padding-top:3px;white-space:nowrap}.schedule-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex:1;min-width:0}.schedule-top .chip{white-space:normal;max-width:100%}
.shipment-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px;margin:16px 0 8px}.shipment-dates dt{font-size:12px;color:var(--muted);margin-bottom:3px}.shipment-dates dd{margin:0;font-size:16px;font-weight:700}.shipment-dates .complete dd{color:var(--green)}.shipment-meta{overflow-wrap:anywhere}.schedule-row .actual{font-weight:500;color:var(--muted)}
@media(max-width:520px){.schedule-badges{flex-basis:100%;justify-content:flex-start}.shipment-dates{gap:10px}.schedule-row{padding:14px 12px}}
.expected{margin:10px 0 5px;display:flex;gap:6px 12px;justify-content:space-between;flex-wrap:wrap}.expected span{font-size:12px;color:var(--muted)}.expected strong{font-size:16px}.schedule-row p{margin:4px 0}.actual{font-weight:650}.actual.complete{color:var(--green)}.rescheduled,.allocation-gap{color:var(--amber)}
.date-context{margin:4px 0}.calendar-link{display:inline-flex;align-items:center;min-height:36px;font-weight:650}.joined{margin-top:6px;color:var(--ink)}.member-row .t{white-space:normal!important}.member-row{align-items:flex-start!important}.member-row .chip{white-space:normal}
.chips .chip{max-width:100%;white-space:normal}
.status-pair{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.status-pair .chip{white-space:normal;max-width:100%}.ship .when .status-pair{margin-left:auto}.ship .when .status-pair .chip{margin-left:0}
.ship.held,.shipment-work.held,.schedule-row.held{border-left-color:var(--wine)}
.como input[type=radio]{display:inline-block!important;width:20px;height:20px;min-height:0;margin-right:8px;flex:none}
:focus-visible{outline:3px solid #b88235;outline-offset:3px}summary{touch-action:manipulation}
@media(max-width:360px){.date-facts{grid-template-columns:1fr}.member-row{flex-wrap:wrap}.top .brand{font-size:17px}}
pre.code{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:12px;overflow:auto;white-space:pre-wrap}
.shipment-work{padding:0;border-left:4px solid var(--line)}.shipment-work.overdue,.shipment-work.exception{border-left-color:var(--red)}.shipment-work.done{border-left-color:var(--green)}
.shipment-work>summary{list-style:none;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px;cursor:pointer}.shipment-work>summary::-webkit-details-marker{display:none}.work-heading{display:flex;flex-direction:column;gap:4px;min-width:0}.work-heading>b{font-size:18px;overflow-wrap:anywhere}
.work-tags{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;max-width:48%}.work-tags .chip{white-space:normal}.work-toggle{font-size:12px;font-weight:650;color:var(--wine);flex-basis:100%;text-align:right}.shipment-work[open] .work-toggle>span{display:inline-block;transform:rotate(180deg)}.work-body{border-top:1px solid var(--line);padding:16px}.work-info{display:grid;grid-template-columns:1fr 1fr;gap:22px}.work-info>*{min-width:0}.work-info h3,.work-order h3{margin:16px 0 8px}.work-info p{margin:6px 0}.work-order{border-top:1px solid var(--line);margin-top:14px}
@media(max-width:520px){.shipment-work>summary{flex-wrap:wrap;padding:14px}.work-tags{max-width:100%;justify-content:flex-start;width:100%}.work-toggle{flex-basis:auto;margin-left:auto}.work-body{padding:14px}.work-info{grid-template-columns:1fr;gap:4px}}

/* ---- display audit fixes (pass 3) ---- */
html,body{overflow-x:clip}
main{overflow-wrap:anywhere}
.top .who{font-size:13px}
@media (max-width:600px){.top .who .mail{display:none}.top .who .out{display:inline}}
@media (min-width:601px){.top .who .out{display:none}}
.tiles{grid-template-columns:repeat(auto-fit,minmax(96px,1fr))}
.tile .l{font-size:12.5px;line-height:1.3;hyphens:auto}
.rows a.row{flex-wrap:wrap;row-gap:6px}
.rows .row .main{flex:1 1 190px}
.rows .row .t{white-space:normal;overflow:visible;text-overflow:clip}
.rows .row>.chip,.rows .row>span.chip{flex:0 1 auto;max-width:100%;white-space:normal;text-align:left}
a.chip,button.chip{min-height:40px;display:inline-flex;align-items:center;padding:0 12px}
dd,td,th{overflow-wrap:anywhere}
@media (max-width:719px){
 main table,main thead,main tbody,main tr,main td,main th{display:block;width:auto!important;min-width:0!important}
 main thead{display:none}
 main tr{background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:8px 0}
 main td{border:0!important;padding:3px 0!important;text-align:left!important}
 main td[data-label]::before{content:attr(data-label);display:block;font-size:12px;font-weight:700;color:var(--muted)}
}


dl.kv{grid-template-columns:minmax(0,max-content) minmax(0,1fr)}
dl.kv dd .chip{white-space:normal;max-width:100%}
@media (max-width:420px){dl.kv{grid-template-columns:minmax(0,1fr)}dl.kv dt{margin-top:6px}}
main .chip{max-width:100%;white-space:normal}
button.chip,.chip[role=button],[onclick].chip{min-height:40px!important;display:inline-flex;align-items:center;padding:0 12px}
@media (max-width:380px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}

.calendar-link{min-height:44px}
@media (max-width:719px){main tr:has(>th){display:none}}

.date-quick{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}.date-quick .chip{border:1px solid var(--line);background:#fff;cursor:pointer;font:600 13px inherit}
.top{transition:transform .2s ease}body.hdr-hide .top{transform:translateY(-100%)}
.sec,.search{transition:top .2s ease}body.hdr-hide .sec,body.hdr-hide .search{top:env(safe-area-inset-top)}
@media (prefers-reduced-motion:reduce){.top,.sec,.search{transition:none}}
`;

const ICON = {
  agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  envios: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  socios: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/></svg>',
  clubes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 2h8M9 2v5c0 2-3 3-3 7v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6c0-4-3-5-3-7V2"/><path d="M6 14h12"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

const SCRIPT = `
(()=>{let y=scrollY;addEventListener('scroll',()=>{const n=scrollY,b=document.body;if(n>y+8&&n>90)b.classList.add('hdr-hide');else if(n<y-8||n<90)b.classList.remove('hdr-hide');y=n},{passive:true})})();
document.addEventListener('change',e=>{const s=e.target.closest('select[data-autosubmit]');if(s&&s.value!==s.dataset.cur)s.form.requestSubmit()});
document.addEventListener('click',e=>{const b=e.target.closest('.date-quick [data-d]');if(!b)return;const f=b.closest('form');const i=f&&f.querySelector('input[type=date]');if(i){i.value=b.dataset.d}});
(()=>{const open=()=>{const t=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));if(t&&t.tagName==='DETAILS'){t.open=true;t.scrollIntoView({block:'start'})}};open();addEventListener('hashchange',open)})();
(()=>{const b=document.querySelector('.bell');if(!b||b.querySelector('.bdg'))return;fetch('/avisos.json').then(r=>r.ok?r.json():null).then(j=>{if(!j||!j.n)return;const s=document.createElement('span');s.className='bdg'+(j.red?' r':'');s.textContent=j.n;b.appendChild(s);b.setAttribute('aria-label','Avisos: '+j.n)}).catch(()=>{})})();
document.querySelectorAll('main table').forEach(t=>{const h=[...t.querySelectorAll('thead th,tr:first-child th')].map(x=>x.textContent.trim());if(!h.length)return;t.querySelectorAll('tbody tr').forEach(r=>[...r.children].forEach((c,i)=>{if(h[i]&&c.tagName==='TD')c.dataset.label=h[i]}))});
document.addEventListener('submit',e=>{const f=e.target;if(f.dataset.busy){e.preventDefault();return}f.dataset.busy=1;
const b=e.submitter;if(b){setTimeout(()=>{b.disabled=true;b.dataset.t=b.textContent;b.textContent='Guardando…'},0)}});
window.addEventListener('pageshow',e=>{if(e.persisted){document.querySelectorAll('form[data-busy]').forEach(f=>delete f.dataset.busy);
document.querySelectorAll('button[disabled][data-t]').forEach(b=>{b.disabled=false;b.textContent=b.dataset.t})}});
const q=document.getElementById('q');if(q){q.addEventListener('input',()=>{const v=q.value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
document.querySelectorAll('[data-s]').forEach(r=>{r.style.display=r.dataset.s.includes(v)?'':'none'});document.querySelectorAll('details[data-search-group]').forEach(d=>{d.open=!!v});const count=document.getElementById('search-results');if(count){const n=[...document.querySelectorAll('[data-s]')].filter(r=>r.style.display!=='none').length;count.textContent=n?n+' resultados':'Sin resultados. Prueba otro nombre, pedido, guía o fecha.'}})}
const ph=document.getElementById('photo');if(ph){ph.addEventListener('change',async()=>{const file=ph.files[0];if(!file)return;
const st=document.getElementById('photo-st');st.textContent='Subiendo…';
try{const img=await createImageBitmap(file);const s=Math.min(1,1600/Math.max(img.width,img.height));const c=document.createElement('canvas');
c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.82));const fd=new FormData();fd.append('file',blob,'foto.jpg');
const r=await fetch(ph.dataset.url,{method:'POST',body:fd});if(!r.ok)throw new Error(await r.text());location.reload()}
catch(err){st.textContent='No se pudo subir: '+err.message}})}
`;

export function page({ title, body, user, env, tab = '', alerts = null, alertsRed = 0 }) {
  const envTag = env.APP_ENV && env.APP_ENV !== 'production' ? `<span class="env">${esc(env.APP_ENV)}</span>` : '';
  const nav = [['/', 'agenda', 'Inicio'], ['/calendario', 'envios', 'Envíos'], ['/socios', 'socios', 'Socios'], ['/clubes', 'clubes', 'Clubes']];
  if (user?.isManager) nav.push(['/ajustes', 'ajustes', 'Ajustes']);
  return new Response(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6b2737"><meta name="robots" content="noindex">
<title>${esc(title)} · Club Dos Búhos</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%236b2737'/%3E%3Ctext x='16' y='22' font-size='17' text-anchor='middle' fill='white' font-family='Georgia'%3EDB%3C/text%3E%3C/svg%3E">
<style>${CSS}</style></head><body>
<header class="top"><a class="brand" href="/">Club Dos Búhos</a>${envTag}${user ? `<a class="bell" href="/avisos" aria-label="Avisos${alerts ? ': ' + alerts : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>${alerts ? `<span class="bdg${alertsRed ? ' r' : ''}">${alerts}</span>` : ''}</a><a class="who" href="/auth/salir" style="color:#fff;text-decoration:none" title="Salir (${esc(user.email)})"><span class="mail">${esc(user.email)}</span><span class="out">Salir</span></a>` : ''}</header>
<main>${body}</main>
${user ? `<nav class="navbar">${nav.map(([href, k, label]) => `<a href="${href}" class="${tab === k ? 'on' : ''}">${ICON[k]}<span>${label}</span></a>`).join('')}</nav>` : ''}
<script>${SCRIPT}</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' } });
}

export function bottleList(list) {
  return `<ul class="blist">${(list || []).map(b => `<li><span class="q">${esc(b.qty)}×</span><span>${esc(b.wine)}</span></li>`).join('')}</ul>`;
}
