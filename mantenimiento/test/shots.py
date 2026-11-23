"""A screenshot of every screen plus checks (nothing wider than the screen, no tap target under 40 px, no JS errors).
   python3 test/shots.py <outdir> [width] [light|dark] [only: comma-separated name parts]. Needs a freshly seeded server."""
import sys, os, asyncio, json
from playwright.async_api import async_playwright
from _env import BASE, state, cookie
OUT = sys.argv[1]; W = int(sys.argv[2]) if len(sys.argv) > 2 else 390; SCHEME = sys.argv[3] if len(sys.argv) > 3 else 'light'
ONLY = sys.argv[4] if len(sys.argv) > 4 else ''
os.makedirs(OUT, exist_ok=True)
IDS = state(); SIDS = IDS['sids']
H = {360: 740, 390: 844, 430: 932, 1280: 860}.get(W, 844)

CHECK = """() => {
  const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, wide: [], small: [], clipped: [] };
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) + '"');
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > window.innerWidth + 1 || r.left < -1) && !el.closest('.skip, .sr, .toast, .mbar, .tl')) out.wide.push(name(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  const sel = 'a[href], button, input:not([type=hidden]):not([type=file]), select, textarea, label[role=button], [role=switch]';
  for (const el of document.querySelectorAll(sel)) {
    if (!vis(el) || el.closest('.hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > document.documentElement.scrollHeight) continue;
    if ((r.height < 40 || r.width < 40) && !el.closest('p, .nh, li.sys, dd, .foot-links, .grid, .dmain, .dtop')) out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return out;
}"""

# (name, hash, user index, steps). A step is a selector to click, or 'js:...' to evaluate, or 'wait:ms', or 'full' for a full-page shot.
SCREENS = [
  ('01-dia', '#/', 1, []),
  ('02-dia-full', '#/', 1, ['full']),
  ('03-dia-hoja', '#/', 1, ['.grid .card .body']),
  ('04-bandeja', '#/bandeja', 1, []),
  ('05-bandeja-hoja', '#/bandeja', 1, ['#pl-items .card .body']),
  ('06-atrasados', '#/atrasados', 1, []),
  ('07-semana', '#/semana', 1, ['full']),
  ('08-todo', '#/todo', 1, ['full']),
  ('09-todo-filtro', '#/todo', 1, ['[data-go=filter]']),
  ('09b-todo-por-area', '#/todo', 1, ['[data-go=filter]', '[data-group=area]', '.sheet [data-act="1"]', 'full']),
  ('09c-todo-por-persona', '#/todo', 1, ['[data-go=filter]', '[data-group=who]', '.sheet [data-act="1"]', 'full']),
  ('09d-todo-por-fecha', '#/todo', 1, ['[data-go=filter]', '[data-group=date]', '.sheet [data-act="1"]', 'full']),
  ('09e-todo-prioridad', '#/todo', 1, ['[data-go=filter]', '[data-group=prio]', '.sheet [data-act="1"]']),
  ('09f-menu', '#/', 1, ['[data-go=menu]']),
  ('09g-contactos-hoja', '#/', 1, ['[data-go=contacts]']),
  ('09h-prioridad', '#/prioridad/2', 1, []),
  ('10-pendiente-tarde', '#/p/{late}', 1, []),
  ('11-pendiente-tarde-full', '#/p/{late}', 1, ['full']),
  ('12-pendiente-foto', '#/p/{photo}', 1, ['full']),
  ('13-hecho', '#/p/{urgent}', 1, ['[data-finish]']),
  ('14-posponer', '#/p/{late}', 1, ['.actionbar [data-set=due]']),
  ('15-asignar', '#/p/{plain}', 1, ['.cell [data-set=who]']),
  ('16-estado', '#/p/{plain}', 1, ['.cell [data-set=status]']),
  ('17-prioridad', '#/p/{plain}', 1, ['.cell [data-set=prio]']),
  ('18-area', '#/p/{plain}', 1, ['.cell [data-set=area]']),
  ('19-menu', '#/p/{plain}', 1, ['[data-menu]']),
  ('20-reportar', '#/nuevo', 3, []),
  ('21-reportar-full', '#/nuevo', 3, ['details.more summary', 'full']),
  ('22-reportar-error', '#/nuevo', 3, ['#r-send']),
  ('30-preventivo', '#/preventivo', 1, []),
  ('31-preventivo-full', '#/preventivo', 1, ['full']),
  ('32-preventivo-2027', '#/preventivo?y=2027', 1, ['full']),
  ('33-planes', '#/planes', 1, []),
  ('34-plan', '#/plan/{plan}', 1, ['full']),
  ('35-plan-nuevo', '#/plan/nuevo', 1, ['full']),
  ('36-plan-proyectado', '#/preventivo?y=2027', 1, ['.pmrow']),
  ('40-equipos', '#/equipos', 1, ['full']),
  ('41-equipo', '#/e/{eq}', 1, []),
  ('42-equipo-full', '#/e/{eq}', 1, ['full']),
  ('43-equipo-nuevo', '#/e/nuevo', 1, ['[data-choice=ef-freq] [data-v="2"]', 'full']),
  ('44-servicio', '#/e/{eq2}/servicio', 1, ['full']),
  ('50-contactos', '#/contactos', 1, ['full']),
  ('51-contacto', '#/c/{ext}', 1, []),
  ('52-contacto-nuevo', '#/c/nuevo', 1, ['full']),
  ('60-cuenta', '#/cuenta', 0, ['full']),
  ('61-personas', '#/personas', 0, ['full']),
  ('62-areas', '#/areas', 0, []),
  ('63-area-editar', '#/areas', 0, ['[data-a="4"]']),
  ('64-resumen', '#/resumen', 0, ['full']),
  ('65-hechos', '#/hechos', 0, []),
  ('66-buscar', '#/buscar?q=refri', 0, ['wait:700']),
  ('67-mis-datos', '#/cuenta', 2, ['[data-edit]']),
]

async def route_theme_async(c):
    from _env import THEME
    if THEME: await c.route('**/theme.css*', lambda r: r.fulfill(status=200, content_type='text/css', body=THEME))
    else: await c.route('**/theme.css*', lambda r: r.abort())
    await c.route('**/fonts.googleapis.com/**', lambda r: r.abort())

async def main():
    issues = {}
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox']) if os.path.exists(os.environ.get('CHROME', '/usr/bin/google-chrome')) else p.chromium.launch())
        async def ctx(sid=None):
            c = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, is_mobile=W < 900, has_touch=W < 900, locale='es-MX', timezone_id='America/Mexico_City', color_scheme=SCHEME)
            await route_theme_async(c)
            if sid: await c.add_cookies([cookie(sid)])
            return c
        pages = {}
        errs = []
        async def page_for(i):
            if i not in pages:
                c = await ctx(SIDS[i]); pg = await c.new_page()
                pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
                pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
                pages[i] = pg
            return pages[i]
        if not ONLY or 'enter' in ONLY:
            c = await ctx(); pg = await c.new_page(); await pg.goto(BASE + '/'); await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'{OUT}/00-entrar.png'); issues['00-entrar'] = await pg.evaluate(CHECK)
            await pg.click('#en-go'); await pg.wait_for_timeout(300); await pg.screenshot(path=f'{OUT}/00-entrar-error.png')
            await c.close()
        for name, h, u, steps in SCREENS:
            if ONLY and not any(o in name for o in ONLY.split(',')): continue
            if W >= 960 and name == '09f-menu': continue   # the menu is a phone thing: on a wide screen the panel has it
            pg = await page_for(u)
            await pg.goto('about:blank'); await pg.goto(BASE + '/' + h.format(**IDS)); await pg.wait_for_timeout(1000)
            full = False
            for s in steps:
                try:
                    if s == 'full': full = True
                    elif s.startswith('js:'): await pg.evaluate(s[3:])
                    elif s.startswith('wait:'): await pg.wait_for_timeout(int(s[5:]))
                    else: await pg.click(s, timeout=4000)
                except Exception as e:
                    errs.append(f'{name}: step {s} failed: {str(e)[:120]}')
                await pg.wait_for_timeout(350)
            await pg.screenshot(path=f'{OUT}/{name}.png', full_page=full)
            issues[name] = await pg.evaluate(CHECK)
        await b.close()
    bad = {k: {a: b for a, b in v.items() if b} for k, v in issues.items() if v['overflow'] > 0 or v['wide'] or v['small']}
    print('ISSUES:', json.dumps(bad, indent=1, ensure_ascii=False)[:6000] if bad else 'none')
    print('ERRORS:', json.dumps(errs, indent=1, ensure_ascii=False)[:3000] if errs else 'none')
asyncio.run(main())
