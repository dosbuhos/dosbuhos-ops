export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fdate = (s) => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d} ${MES[+m - 1]} ${y}`; };
export const mxn = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
export const int = (n) => (Number(n) || 0).toLocaleString('es-MX');

const CSS = `
:root{--ink:#1f1d1b;--muted:#6b6560;--line:#e4dfd8;--bg:#faf8f5;--card:#fff;--wine:#6b2737;--wine-soft:#f3e7e9;
--red:#b42318;--red-soft:#fdecea;--amber:#9a5b00;--amber-soft:#fdf3e1;--green:#1e6b3a;--green-soft:#e6f4ea;--r:12px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--wine)}header.top{background:var(--wine);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:5}
header.top a{color:#fff;text-decoration:none}header.top .brand{font-weight:700;letter-spacing:.2px}header.top nav{margin-left:auto;display:flex;gap:12px;font-size:14px;flex-wrap:wrap;justify-content:flex-end}
@media(max-width:560px){header.top .brand span{display:none}header.top nav{gap:10px;font-size:13px}}
main{max-width:720px;margin:0 auto;padding:16px}main.wide{max-width:1180px}
h1{font-size:22px;margin:4px 0 12px}h2{font-size:17px;margin:22px 0 8px}h3{font-size:15px;margin:16px 0 6px}
.muted{color:var(--muted)}.small{font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin:10px 0}
.banner{border-radius:var(--r);padding:12px 14px;margin:10px 0;font-weight:600}
.banner.red{background:var(--red-soft);color:var(--red)}.banner.amber{background:var(--amber-soft);color:var(--amber)}.banner.green{background:var(--green-soft);color:var(--green)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.3px}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.btn{display:inline-block;background:var(--wine);color:#fff;border:0;border-radius:10px;padding:12px 16px;font-size:16px;font-weight:600;text-decoration:none;cursor:pointer}
.btn.ghost{background:#fff;color:var(--wine);border:1px solid var(--wine)}.btn.small{padding:7px 11px;font-size:14px}.btn.block{display:block;width:100%;text-align:center}
.btn:disabled{opacity:.5}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;background:#eee;color:#444;white-space:nowrap}
.pill.abierto{background:var(--amber-soft);color:var(--amber)}.pill.devuelto,.pill.overdue{background:var(--red-soft);color:var(--red)}
.pill.enviado{background:#e8eefc;color:#1d4ed8}.pill.aprobado{background:var(--green-soft);color:var(--green)}
label{display:block;font-size:14px;font-weight:600;margin:12px 0 4px}
input,select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #cfc8bf;border-radius:10px;background:#fff;color:var(--ink)}
textarea{min-height:76px}input[type=number]{max-width:110px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media(max-width:560px){.grid2,.grid3{grid-template-columns:1fr}}
.wine-row{border:1px solid var(--line);border-radius:var(--r);padding:12px;margin:10px 0;background:#fff}
.wine-row .head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.wine-row .nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.wine-row .nums label{font-size:12px;margin:0 0 2px;font-weight:600;color:var(--muted)}
.wine-row .nums input{max-width:none;text-align:center}
.status{font-weight:700;font-size:13px}.status.ok{color:var(--green)}.status.bad{color:var(--red)}
.photos{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.photos img{width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.upl{border:1px dashed #cfc8bf;border-radius:var(--r);padding:10px;margin:8px 0;background:#fff}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:12px}
.kpi .v{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}.kpi .l{font-size:12px;color:var(--muted)}
.kpi.bad .v{color:var(--red)}
.sticky-foot{position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 30%);padding:18px 0 10px}
.errs{background:var(--red-soft);color:var(--red);border-radius:var(--r);padding:10px 14px;margin:10px 0}.errs li{margin:3px 0}
.toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;opacity:0;transition:.3s}
.toast.show{opacity:1}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.spacer{flex:1}
dl.kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0}dl.kv dt{color:var(--muted);font-size:14px}dl.kv dd{margin:0}
`;

export function layout({ title, body, user, wide = false, admin = false }) {
  const nav = admin
    ? `<a href="/admin">Resumen</a><a href="/admin/eventos">Eventos</a><a href="/admin/vinos">Vinos</a><a href="/admin/conteos">Conteos</a><a href="/admin/reps">Vendedores</a>${user?.rep ? '<a href="/">Mi bodega</a>' : ''}`
    : `<a href="/">Mi bodega</a><a href="/seguimientos">Seguimientos</a><a href="/conteo">Conteo</a>${user?.isAdmin ? '<a href="/admin">Admin</a>' : ''}`;
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Muestras Dos Búhos</title>
<style>${CSS}</style></head><body>
<header class="top"><a class="brand" href="${admin ? '/admin' : '/'}">Muestras<span> · Dos Búhos</span></a><nav>${nav}</nav></header>
<main class="${wide ? 'wide' : ''}">${body}</main><div class="toast" id="toast"></div>
<script>function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}</script>
</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export const pill = (status, label) => `<span class="pill ${esc(status)}">${esc(label || status)}</span>`;
