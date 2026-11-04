// Capturas móviles (iPhone 13) del resto de páginas + comprobación de scroll horizontal y solape del botón flotante.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8787';
const OUT = process.env.OUT || '/home/claude/shots/n';
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['parcelas', 'fenologia', 'labores', 'tratamientos', 'maduracion', 'recepcion', 'analisis', 'calculadora', 'catas', 'embotellados', 'usuarios', 'saldos', 'ayuda', 'conciliacion', 'limpieza', 'materiales', 'equipos', 'alertas', 'traza', 'actividad', 'mas', 'productos-terminados', 'ubicaciones', 'coupage', 'depositos', 'operaciones', 'inventario?tab=granel'];
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'] }); const page = await ctx.newPage(); page.setDefaultTimeout(5000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
for (const p of PAGES) {
  await page.goto(`${BASE}/#/${p}`); await page.waitForTimeout(700);
  const info = await page.evaluate(() => {
    const sw = document.documentElement.scrollWidth, cw = document.documentElement.clientWidth;
    const fab = document.querySelector('.page-head .actions .btn.primary');
    let fabOver = '';
    if (fab) { const r = fab.getBoundingClientRect(); window.scrollTo(0, document.body.scrollHeight); const last = [...document.querySelectorAll('#page > *')].pop(); const lr = last ? last.getBoundingClientRect() : null; if (lr && lr.bottom > r.top && lr.right > r.left) fabOver = `FAB solapa ${last.className.slice(0, 20)}`; window.scrollTo(0, 0); }
    const wide = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.right > cw + 1 && getComputedStyle(el).position !== 'fixed'; }).slice(0, 3).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
    return { over: sw > cw + 1 ? `${sw}>${cw}` : '', wide, fabOver, h1: document.querySelector('h1')?.textContent?.trim().slice(0, 30) || '' };
  });
  await page.screenshot({ path: `${OUT}-${p.replace(/[?=\/]/g, '_')}.png` });
  console.log(`${info.over || info.wide.length || info.fabOver ? '✗' : '✓'} ${p.padEnd(28)} ${info.h1.padEnd(30)} ${info.over} ${info.wide.join(',')} ${info.fabOver}`);
}
await b.close();
