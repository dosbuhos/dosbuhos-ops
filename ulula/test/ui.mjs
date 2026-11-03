// Recorrido de la interfaz con Playwright contra wrangler dev local: cada página carga sin errores de consola y sin scroll horizontal en móvil.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8787';
const PAGES = ['panel', 'conciliacion', 'conciliacion?tab=pendientes', 'conciliacion?tab=medir&mode=inventory', 'limpieza', 'parcelas-compradas', 'materiales', 'materiales?tab=entradas', 'alertas', 'equipos', 'operarios', 'integraciones', 'depositos?tab=ubicaciones', 'maduracion?tab=comparar', 'maduracion?tab=yan', 'calculadora?tab=generica', 'inventario?tab=preenvasado', 'inventario?tab=terminado', 'inventario?tab=consumibles', 'embotellados?tab=packed', 'parcelas', 'parcelas?tab=mapa', 'fenologia', 'labores', 'tratamientos', 'tratamientos?tab=productos', 'maduracion', 'recepcion', 'fermentaciones', 'tablero', 'operaciones', 'coupage', 'traza', 'traza?lot=1', 'analisis', 'analisis?tab=tendencias&lot=1', 'calculadora', 'catas', 'inventario', 'inventario?tab=lotes', 'inventario?tab=lotes&sub=auditoria', 'inventario?tab=productos', 'embotellados', 'productos-terminados', 'perfil', 'depositos', 'depositos?adv=1', 'ubicaciones', 'usuarios', 'saldos', 'saldos?tab=embotellado', 'productos', 'ayuda', 'recipiente/1', 'actividad', 'mas'];
const browser = await chromium.launch();
let fails = 0;
for (const [name, ctxOpts] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['iphone', { ...devices['iPhone 13'] }]]) {
  const ctx = await browser.newContext(ctxOpts); const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/leaflet|unpkg|arcgisonline|fonts.g|hub.dos-buhos|net::ERR|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`); });
  for (const p of PAGES) {
    errors.length = 0;
    await page.goto(`${BASE}/#/${p}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h1: document.querySelector('h1')?.textContent?.trim() || '', alert: document.querySelector('.alert.bad')?.textContent?.trim() || '' }));
    const over = info.sw > info.cw + 1;
    const bad = errors.length || over || (info.alert && !/No se pudo cargar el mapa/.test(info.alert));
    if (bad) fails++;
    console.log(`${bad ? '✗' : '✓'} ${name.padEnd(8)} ${p.padEnd(40)} ${info.h1.slice(0, 28).padEnd(30)}${over ? ` OVERFLOW ${info.sw}>${info.cw}` : ''}${info.alert ? ` ALERT ${info.alert.slice(0, 80)}` : ''}${errors.length ? ' ' + errors.join(' | ').slice(0, 300) : ''}`);
  }
  if (name === 'iphone') { await page.goto(`${BASE}/#/tablero`); await page.waitForTimeout(600); await page.screenshot({ path: '/home/claude/shots/ulula-m-tablero.png', fullPage: false }); await page.goto(`${BASE}/#/panel`); await page.waitForTimeout(600); await page.screenshot({ path: '/home/claude/shots/ulula-m-panel.png' }); await page.click('#burger'); await page.waitForTimeout(300); await page.screenshot({ path: '/home/claude/shots/ulula-m-menu.png' }); }
  else { for (const p of ['panel', 'tablero', 'operaciones', 'recipiente/1', 'parcelas', 'fermentaciones', 'inventario', 'depositos']) { await page.goto(`${BASE}/#/${p}`); await page.waitForTimeout(700); await page.screenshot({ path: `/home/claude/shots/ulula-d-${p.replace('/', '-')}.png` }); } await page.goto(`${BASE}/#/operaciones`); await page.waitForTimeout(600); await page.click('#newop'); await page.waitForTimeout(400); await page.screenshot({ path: '/home/claude/shots/ulula-d-opmodal.png' }); }
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} páginas con problemas` : 'UI OK');
process.exit(fails ? 1 : 0);
