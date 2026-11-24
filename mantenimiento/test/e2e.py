"""Every main flow through the real UI on a phone viewport. Needs a freshly seeded local server (see seed.py)."""
import os, re, tempfile, datetime as dt
from PIL import Image
from playwright.sync_api import sync_playwright, expect
from _env import BASE, HERE, state, launch, route_theme, cookie
SIDS = state()['sids']
JPG_PATH = os.path.join(tempfile.gettempdir(), 'mantenimiento-sample.jpg')
Image.new('RGB', (2400, 1800), (120, 90, 60)).save(JPG_PATH, 'JPEG', quality=92)     # a phone-sized photo
ok = []; errs = []
def step(name): ok.append(name); print('  ✓', name)

with sync_playwright() as p:
    b = launch(p)
    def ctx(sid=None, w=390, h=844):
        c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='es-MX', timezone_id='America/Mexico_City')
        route_theme(c)
        c.route('https://wa.me/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<title>wa</title>'))
        if sid: c.add_cookies([cookie(sid)])
        c.set_default_timeout(6000)
        return c
    def watch(pg):
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        # 4xx answers are part of the flows below (validation, permissions); anything else on the console is a bug
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    toast = lambda pg: pg.locator('#toast.show .tmsg')
    tab = lambda pg: pg.locator('.mbar [aria-current]')            # the view lit in the ribbon (phones)
    head = lambda pg: pg.locator('.mh h1')                         # the title of a main screen
    api_task = lambda pg, tid: pg.evaluate("(id) => fetch('/api/tasks/' + id).then((r) => r.json()).then((d) => d.task)", str(tid))
    def area(pg, sel, text):                                       # pick an area in a drop-down by part of its name
        v = pg.evaluate("([s, t]) => { const o = [...document.querySelector(s).options].find((x) => x.text.includes(t)); return o ? o.value : null; }", [sel, text])
        assert v, 'no area ' + text
        pg.select_option(sel, v)

    # ---------- 1. sign up ----------
    c = ctx(); pg = c.new_page(); watch(pg)
    pg.goto(BASE + '/#/p/9')                       # deep link while signed out
    expect(pg.locator('.enter h1')).to_have_text('Esmero')
    pg.click('#en-go'); expect(pg.locator('#en-err')).to_contain_text('nombre')
    pg.fill('#en-phone', '415 555 0199'); pg.click('#en-go'); expect(pg.locator('#en-err')).to_have_text('Escribe tu nombre y apellido')   # new phone, no name
    pg.fill('#en-name', 'Rosa Méndez'); pg.fill('#en-phone', '415 12'); pg.click('#en-go')
    expect(pg.locator('#en-err')).to_contain_text('10 dígitos')
    pg.fill('#en-phone', '415 555 0199'); pg.click('#en-go')
    expect(pg.locator('.top.sub h1')).to_have_text('Pendiente #9')   # lands on the link she opened
    step('sign-up with name + WhatsApp, lands on the deep link')
    # the app opens on today's hours, the way Horizonte does: what has no hour on top, the blocks on the grid
    pg.goto(BASE + '/'); expect(tab(pg)).to_have_text('Día'); expect(pg.locator('.mtop .tdy')).to_have_text('Hoy')
    expect(pg.locator('.wstrip button')).to_have_count(7); expect(pg.locator('.wstrip button[aria-pressed=true]')).to_have_class(re.compile('today'))
    expect(pg.locator('.foldrow .lbl')).to_contain_text('sin hora'); assert pg.locator('.mm > .card').count() >= 1
    assert pg.locator('.hgrid .grid .card.blk').count() >= 2 and pg.locator('.nav .mbar a').count() == 6
    expect(pg.locator('.mbar a:has-text("Atrasados") .n')).to_have_text('2')
    pg.click('[data-go=fold]'); expect(pg.locator('.mm > .card')).to_have_count(0); pg.click('[data-go=fold]'); assert pg.locator('.mm > .card').count() >= 1
    step('opens on the day: week strip, what has no hour, the blocks, the ribbon with its counts')
    # the ribbon's views take each other's place in history: Back does not walk through them
    h0 = pg.evaluate('history.length')
    pg.click('.mbar a:has-text("Bandeja")'); expect(head(pg)).to_contain_text('Bandeja'); expect(tab(pg)).to_contain_text('Bandeja')
    n_in = pg.locator('#pl-items .card').count(); assert n_in >= 2 and pg.locator('#pl-items .card .due').count() == 0     # nothing in it has a day
    pg.click('.mbar a:has-text("Atrasados")'); expect(head(pg)).to_contain_text('Atrasados'); assert pg.locator('#pl-items .card').count() == pg.locator('#pl-items .card.late').count() == 2
    pg.click('.mbar a:has-text("Semana")'); expect(pg.locator('.mday')).to_have_count(7); expect(pg.locator('.mday .tpill')).to_have_text('Hoy')
    pg.click('.mbar a:has-text("Todo")'); expect(head(pg)).to_contain_text('Todo'); assert pg.locator('#pl-items .card').count() >= 8
    pg.click('.mbar a:has-text("Día")'); expect(tab(pg)).to_have_text('Día'); assert pg.evaluate('history.length') == h0
    step('Bandeja, Atrasados, Semana, Todo and back to Día from the ribbon')

    # ---------- 2. report with a photo ----------
    fab = pg.locator('.nav .fab'); expect(fab).to_be_visible(); assert fab.bounding_box()['x'] > 300      # Reportar floats in the corner
    fab.click(); expect(pg.locator('.top.sub h1')).to_have_text('Reportar')
    pg.click('#r-send'); expect(pg.locator('.ferr')).to_have_text('Escribe qué pasa')
    pg.fill('#r-title', 'Se cayó la canaleta de la entrada')
    pg.click('#r-send'); expect(pg.locator('.ferr')).to_have_text('Elige dónde está el problema')
    assert pg.locator('#r-area').bounding_box()['height'] < 60      # one line on the screen, not a wall of chips
    area(pg, '#r-area', 'Instalaciones'); expect(pg.locator('.ferr')).to_have_count(0)
    pg.set_input_files('#r-pick-gal', JPG_PATH)
    expect(pg.locator('#r-pick [data-local] .ph')).to_have_count(1)
    pg.click('[data-choice="r-prio"] .ch:has-text("Urgente")')
    pg.click('#r-send')
    expect(pg.locator('.sent h1')).to_have_text('Reporte enviado', timeout=15000)
    expect(pg.locator('.sent a.wa')).to_contain_text('Avisar a Adrián')
    step('report: inline errors, photo, urgent, WhatsApp heads-up to the coordinator')
    pg.click('.sent a:has-text("Ver el reporte")')
    expect(pg.locator('.hero h2')).to_have_text('Se cayó la canaleta de la entrada')
    expect(pg.locator('#d-photos .ph[data-photo]')).to_have_count(1)
    expect(pg.locator('.cell:has-text("Fecha") .un')).to_have_text('Sin fecha')                           # nothing gets a day by itself, the urgent neither
    tid = int(re.search(r'#/p/(\d+)', pg.url).group(1)); t = api_task(pg, tid); assert t['due_date'] is None and t['priority'] == 1, t
    pg.goto(BASE + '/#/bandeja'); expect(pg.locator('#pl-items .card[data-tid="%d"]' % tid)).to_be_visible(); expect(pg.locator('.mbar a:has-text("Bandeja") .n')).to_have_class(re.compile('late'))   # and the Bandeja says something urgent waits
    pg.goto(BASE + '/#/p/%d' % tid); pg.click('.actionbar [data-set=due]'); expect(pg.locator('.sheet h2')).to_have_text('Poner fecha'); pg.click('.sheet .dopt:has-text("Hoy")'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.cell:has-text("Fecha") .due')).to_have_text('Para hoy')
    step('the report opens with its photo and no day: it waits in the Bandeja, urgent or not, until someone gives it one')
    # photo viewer: closes with its button and with the phone's Back button, staying on the page
    pg.click('#d-photos .ph[data-photo]'); expect(pg.locator('#viewer img')).to_be_visible(); pg.click('#viewer [data-close]'); expect(pg.locator('#viewer')).to_be_hidden()
    pg.click('#d-photos .ph[data-photo]'); expect(pg.locator('#viewer img')).to_be_visible(); pg.go_back(); expect(pg.locator('#viewer')).to_be_hidden()
    expect(pg.locator('.hero h2')).to_have_text('Se cayó la canaleta de la entrada')
    pg.click('.cell [data-set=prio]'); expect(pg.locator('.sheet h2')).to_have_text('Prioridad'); pg.go_back(); expect(pg.locator('#sheet')).to_be_hidden()
    expect(pg.locator('.hero h2')).to_have_text('Se cayó la canaleta de la entrada'); assert '#/p/' in pg.url
    pg.click('[data-menu]'); pg.click('.sheet [data-x]'); expect(pg.locator('#sheet')).to_be_hidden(); pg.wait_for_timeout(200); assert '#/p/' in pg.url
    step('Back closes a sheet or a photo without leaving the page')

    # ---------- 3. assign, postpone, priority, note ----------
    pg.click('.cell [data-set=who]'); expect(pg.locator('.sheet h2')).to_have_text('¿Quién lo hace?')
    pg.fill('#as-q', 'herr'); expect(pg.locator('.sheet .opt[data-p]:visible')).to_have_count(1)
    pg.fill('#as-q', ''); pg.click('.sheet .opt:has-text("Chuy Hernández")')
    expect(toast(pg)).to_have_text('Asignado a Chuy'); expect(pg.locator('#toast button')).to_have_text('Avisar por WhatsApp')
    expect(pg.locator('.cell:has-text("Lo hace") .cv')).to_contain_text('Chuy Hernández')
    expect(pg.locator('.cunder a:has-text("WhatsApp")')).to_be_visible()
    href = pg.locator('.cunder a:has-text("WhatsApp")').get_attribute('href'); assert href.startswith('https://wa.me/524155550125?text='), href
    step('assign to an outside provider; call and WhatsApp buttons appear')
    pg.click('.actionbar [data-set=due]'); expect(pg.locator('.sheet h2')).to_have_text('Posponer')
    pg.click('.sheet [data-act="1"]'); expect(pg.locator('#ds-err')).to_have_text('Elige una fecha')
    pg.click('.sheet .dopt:has-text("En una semana")'); pg.click('.sheet .qchip:has-text("Falta material")'); pg.click('.sheet [data-act="1"]')
    expect(toast(pg)).to_contain_text('Pospuesto para')
    expect(pg.locator('.cell:has-text("Fecha") .csub')).to_contain_text('pospuesto 1 vez')
    expect(pg.locator('.timeline')).to_contain_text('Falta material')
    step('postpone with a reason; the count and the reason are kept')
    pg.click('.cell [data-set=prio]'); pg.click('.sheet .opt:has-text("Alta")'); expect(toast(pg)).to_have_text('Prioridad: Alta')
    pg.click('.cell [data-set=area]'); pg.click('.sheet .opt:has-text("Hospedaje")'); expect(pg.locator('.hmeta .tag')).to_have_text('Hospedaje')
    pg.click('.cell [data-set=status]'); pg.click('.sheet .opt:has-text("Esperando material")'); expect(pg.locator('.cell:has-text("Estado") .pill')).to_have_text('Esperando material')
    pg.click('.cell [data-set=cost]'); pg.fill('#cs-in', '450'); pg.click('.sheet [data-act="1"]'); expect(pg.locator('.cell:has-text("Costo") .cv')).to_have_text('$450')
    pg.fill('#d-note', 'Ya pedí la canaleta nueva a la ferretería.'); pg.click('#d-send')
    expect(pg.locator('.timeline .note .nt')).to_have_text('Ya pedí la canaleta nueva a la ferretería.')
    step('priority, area, status, cost and a note, each in one or two taps')
    pg.click('[data-menu]'); pg.click('.sheet .opt:has-text("Editar")'); pg.fill('#ed-title', 'Se cayó la canaleta de la entrada principal'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.hero h2')).to_have_text('Se cayó la canaleta de la entrada principal')
    assert pg.locator('.sheet .opt:has-text("Eliminar")').count() == 0     # not an admin
    code = lambda method, path, body=None: pg.evaluate("([m, p, b]) => fetch('/api' + p, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then((r) => r.status)", [method, path, body])
    assert code('DELETE', f'/tasks/{tid}') == 403 and code('PATCH', '/users/1', {'role': 'staff'}) == 403
    assert code('POST', '/areas', {'name': 'X'}) == 403 and code('PATCH', '/settings', {'signup_open': False}) == 403
    assert code('DELETE', '/equipment/1') == 403 and code('DELETE', '/providers/1') == 403
    step('edit the title; no delete for non-admins, in the screen or through the API')

    # ---------- 4. done, with photo, then reopen ----------
    pg.click('[data-finish]'); expect(pg.locator('.sheet h2')).to_have_text('Marcar hecho')
    pg.click('.sheet .qchip:has-text("Se cambió la pieza")'); pg.set_input_files('#dn-pick-gal', JPG_PATH); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.cell:has-text("Estado") .pill')).to_have_text('Hecho', timeout=15000)
    expect(pg.locator('#d-photos .ph[data-photo]')).to_have_count(2)
    assert pg.locator('#d-photos .pstrip .ph.big').first.bounding_box()['width'] > 250 and pg.locator('#d-photos').bounding_box()['y'] < pg.locator('.hero h2').bounding_box()['y']   # the photo is large and comes first
    expect(pg.locator('#d-photos .pcount')).to_have_text('1 / 2'); pg.evaluate("document.querySelector('#d-photos .pstrip').scrollLeft = 9999"); expect(pg.locator('#d-photos .pcount')).to_have_text('2 / 2')
    expect(pg.locator('.timeline .note .nt').last).to_have_text('Se cambió la pieza')
    pg.click('[data-reopen]'); expect(pg.locator('.cell:has-text("Estado") .pill')).to_have_text('Por hacer')
    step('mark done with a note and a photo; reopen')

    # ---------- 5. Todo: by priority, filter, group, search, tick ----------
    pg.goto(BASE + '/#/todo'); expect(head(pg)).to_contain_text('Todo'); pg.wait_for_timeout(900)
    cards = pg.locator('#pl-items .card'); n_all = cards.count(); assert pg.locator('.mtop .cnt').inner_text() == str(n_all)
    # it opens grouped by priority, most urgent first; priority is also a filter
    heads = pg.locator('#pl-items h2.eyebrow').all_inner_texts(); assert heads[0].startswith('Urgente') and heads[1].startswith('Alta'), heads
    n_urg = pg.locator('#pl-items .card.p1').count(); assert n_urg > 0
    pg.click('[data-go=filter]'); pg.click('.sheet [data-prio="1"]'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.fchip')).to_have_text('Urgente'); assert cards.count() == n_urg; expect(pg.locator('[data-go=filter]')).to_have_attribute('aria-pressed', 'true')
    pg.click('.fchip'); expect(pg.locator('.fchip')).to_have_count(0); assert cards.count() == n_all
    pg.click('[data-go=filter]'); pg.click('.sheet [data-area]:has-text("Restaurante")'); pg.click('.sheet [data-group=area]'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.fchip')).to_have_count(2); assert pg.locator('#pl-items h2.eyebrow .tag').count() == 1
    pg.reload(); expect(pg.locator('.fchip')).to_have_count(2)          # the filter and the order are remembered
    pg.click('.fchip.tagc'); expect(pg.locator('.fchip')).to_have_count(1)
    pg.click('[data-go=filter]'); pg.click('.sheet [data-who=mine]'); expect(pg.locator('.sheet [data-who=mine]')).to_have_attribute('aria-pressed', 'true'); pg.click('.sheet [data-act="0"]')
    expect(pg.locator('.fchip')).to_have_count(0); expect(pg.locator('#pl-items h2.eyebrow').first).to_contain_text('Urgente')
    pg.fill('#pl-q', 'canaleta'); expect(cards).to_have_count(1); expect(pg.locator('.mtop .cnt')).to_have_text('1'); expect(pg.locator('#pl-q')).to_be_focused()
    expect(pg.locator('#pl-items a.showmore')).to_have_attribute('href', re.compile('#/buscar\\?q=canaleta'))
    pg.fill('#pl-q', 'zzzz'); expect(pg.locator('#pl-items .empty h2')).to_contain_text('Nada con'); pg.fill('#pl-q', ''); expect(cards).to_have_count(n_all)
    step('Todo opens by priority; priority and area filter it; grouping persists; filters clear; search narrows it')
    pg.locator('#pl-items .card .ck[data-done]').first.click(); expect(pg.locator('.sheet h2')).to_have_text('Marcar hecho'); pg.click('.sheet [data-act="1"]')
    expect(toast(pg)).to_contain_text('Hecho'); pg.wait_for_timeout(600); assert cards.count() == n_all - 1
    pg.click('#toast button'); pg.wait_for_timeout(900); assert cards.count() == n_all
    step('tick a card → done in two taps, with undo')

    # ---------- 5b. a pendiente opens in a sheet over the list: day, hour, how long, priority, who ----------
    pg.goto(BASE + '/#/bandeja'); expect(head(pg)).to_contain_text('Bandeja'); pg.wait_for_timeout(700)
    foco = pg.locator('#pl-items .card:has-text("Foco fundido")'); fid = foco.get_attribute('data-tid'); n_in = pg.locator('#pl-items .card').count()
    expect(foco.locator('.rm')).to_contain_text('Reportado')
    url0 = pg.url; foco.locator('.body').click(); sh = pg.locator('.sheet.tsheet'); expect(sh.locator('h2')).to_have_text('Foco fundido en la terraza del restaurante'); assert pg.url == url0
    expect(sh.locator('[data-when=""]')).to_have_attribute('aria-pressed', 'true'); expect(sh.locator('.stepper div')).to_have_text('Sin estimar')
    pg.go_back(); expect(pg.locator('#sheet')).to_be_hidden(); assert pg.url == url0                       # Back closes the sheet, the list stays
    foco.locator('.body').click(); expect(sh).to_be_visible()
    sh.locator('.when button:has-text("Mañana")').click(); expect(sh.locator('.when button:has-text("Mañana")')).to_have_attribute('aria-pressed', 'true')
    expect(pg.locator('#pl-items .card')).to_have_count(n_in - 1)                                           # it left the Bandeja behind the sheet
    sh.locator('#ts-time').fill('14:30'); sh.locator('#ts-time').dispatch_event('change'); expect(sh.locator('.stepper div')).to_have_text('1 h')
    sh.locator('[data-dur="1"]').click(); expect(sh.locator('.stepper div')).to_have_text('1 h 30'); expect(sh.locator('[data-dur="1"]')).to_be_focused()
    sh.locator('[data-prio="2"]').click(); expect(sh.locator('[data-prio="2"]')).to_have_attribute('aria-checked', 'true'); pg.wait_for_timeout(400)
    t = api_task(pg, fid); assert t['plan_min'] == 870 and t['est_min'] == 90 and t['priority'] == 2 and t['due_date'] and not t['postponed'], t
    sh.locator('[data-pickwho]').click(); expect(pg.locator('.sheet h2')).to_have_text('¿Quién lo hace?'); pg.click('.sheet .opt:has-text("Raúl Mendoza")')
    expect(sh.locator('[data-pickwho]')).to_contain_text('Raúl Mendoza', timeout=8000)                       # the pendiente comes back with the contact on it
    expect(sh.locator('.whorow a.wa')).to_have_attribute('href', re.compile('^https://wa\\.me/524155550150\\?text='))
    sh.locator('[data-when=pick]').click(); expect(pg.locator('.sheet h2')).to_have_text('Posponer'); pg.click('.sheet .dopt:has-text("En 3 días")'); pg.click('.sheet [data-act="1"]')
    expect(sh.locator('[data-when=pick]')).to_have_attribute('aria-pressed', 'true', timeout=8000)
    sh.locator('[data-x]').click(); expect(pg.locator('#sheet')).to_be_hidden()
    pg.click('.mbar a:has-text("Semana")'); wk = pg.locator('.mday .card[data-tid="%s"]' % fid)
    expect(pg.locator('.mday').first).to_be_visible(); pg.wait_for_timeout(300)
    if (dt.date.today() + dt.timedelta(days=3)).isocalendar()[1] != dt.date.today().isocalendar()[1]: pg.click('.mtop [data-step="1"]')   # three days from now can fall in next week
    expect(wk.locator('.meta')).to_have_text('14:30'); expect(wk.locator('.rm')).to_contain_text('Raúl')
    wk.locator('.body').click(); sh.locator('[data-when=""]').click(); expect(sh.locator('.twhen')).to_contain_text('Bandeja'); expect(sh.locator('#ts-time')).to_have_value('')
    pg.keyboard.press('Escape'); expect(pg.locator('.mday .card[data-tid="%s"]' % fid)).to_have_count(0)
    step('the sheet: a day, an hour, how long, the priority, a contact to do it, another day, back to the Bandeja')

    # ---------- 5c. the menu, Contactos one tap away, coming back where you were ----------
    pg.goto(BASE + '/#/'); expect(tab(pg)).to_have_text('Día')
    pg.click('[data-go=menu]'); expect(pg.locator('.sheet.msheet h2')).to_have_text('Tableros'); assert pg.locator('.msheet .rowlink:visible').count() == 10
    pg.click('.msheet .rowlink:has-text("Equipos")'); expect(head(pg)).to_have_text('Equipos'); expect(pg.locator('#sheet')).to_be_hidden(); expect(pg.locator('.mbar')).to_be_visible()
    pg.go_back(); expect(tab(pg)).to_have_text('Día'); pg.wait_for_timeout(300)
    pg.click('[data-go=menu]'); pg.click('.msheet .rowlink:has-text("Alta")'); expect(head(pg)).to_contain_text('Alta'); assert pg.locator('#pl-items .card').count() == pg.locator('#pl-items .card.p2').count() > 0
    pg.go_back(); expect(tab(pg)).to_have_text('Día'); pg.wait_for_timeout(300)
    pg.click('[data-go=contacts]'); cs = pg.locator('.sheet.csheet'); expect(cs.locator('h2')).to_have_text('Contactos'); n_c = cs.locator('.lrow.person:visible').count(); assert n_c >= 8
    assert cs.locator('.lrow.person a.wa').first.get_attribute('href').startswith('https://wa.me/52')
    cs.locator('#cs-q').fill('plom'); expect(cs.locator('.lrow.person:visible')).to_have_count(1); expect(cs.locator('.lrow.person:visible')).to_contain_text('Chuy Hernández')
    cs.locator('.lrow.person:visible .pmain').click(); expect(pg.locator('.who-card h2')).to_have_text('Chuy Hernández'); expect(pg.locator('#sheet')).to_be_hidden()
    pg.go_back(); expect(tab(pg)).to_have_text('Día')
    pg.goto(BASE + '/#/todo'); pg.wait_for_timeout(700); pg.evaluate('window.scrollTo(0, 420)'); pg.wait_for_timeout(100)
    pg.locator('#pl-items .card .body').last.click(); y0 = pg.evaluate('window.scrollY'); assert y0 >= 420, y0
    pg.click('.sheet.tsheet [data-act="0"]'); expect(pg.locator('.top.sub h1')).to_contain_text('Pendiente #'); assert pg.evaluate('window.scrollY') == 0
    pg.click('.top.sub [data-back]'); expect(head(pg)).to_contain_text('Todo'); pg.wait_for_timeout(300); assert abs(pg.evaluate('window.scrollY') - y0) < 40, (pg.evaluate('window.scrollY'), y0)
    step('menu → Equipos and a priority; the phone icon → Contactos with search; back puts the list where it was')
    # the areas, behind a fold in the menu: where the open work is, and each one's list
    pg.goto(BASE + '/#/'); pg.wait_for_timeout(500); pg.click('[data-go=menu]'); expect(pg.locator('.sheet .mfold')).not_to_have_attribute('open', ''); pg.click('.sheet .mfold summary')
    arow = pg.locator('.sheet .mfold .rowlink:has-text("Restaurante")'); expect(arow).to_be_visible(); n_rest = int(arow.locator('.n').inner_text()); assert n_rest >= 1
    arow.click(); expect(head(pg)).to_contain_text('Restaurante'); expect(pg.locator('#pl-items .card')).to_have_count(n_rest); expect(pg.locator('.mbar [aria-current]')).to_have_count(0)
    assert pg.locator('#pl-items .card .tag').count() == 0 and pg.locator('#pl-items .eyebrow').count() >= 1          # by priority, without repeating the area on each card
    pg.go_back(); expect(tab(pg)).to_have_text('Día'); pg.click('[data-go=menu]'); expect(pg.locator('.sheet .mfold')).to_have_attribute('open', ''); pg.click('.sheet [data-x]')   # it stays open
    step('menu → Áreas opens to show each area with its count; an area lists its open pendientes by priority')
    # the Horizonte-style panel: type it and press Enter, and filter and sort on any list
    pg.goto(BASE + '/#/bandeja'); pg.wait_for_timeout(600); n0 = pg.locator('#pl-items .card').count()
    pg.fill('#pl-add', 'Revisar la chapa del portón'); pg.keyboard.press('Enter'); expect(pg.locator('#pl-items .card')).to_have_count(n0 + 1); expect(pg.locator('#pl-add')).to_have_value(''); expect(pg.locator('#pl-add')).to_be_focused()
    qid = pg.locator('#pl-items .card:has-text("Revisar la chapa del portón")').get_attribute('data-tid'); t = api_task(pg, qid); assert t['due_date'] is None and t['priority'] == 3 and t['area_id'] is None, t
    pg.click('[data-go=filter]'); expect(pg.locator('.sheet h2')).to_have_text('Filtrar y ordenar'); pg.click('.sheet [data-group=old]'); pg.click('.sheet [data-act="1"]')
    heads = pg.locator('#pl-items .eyebrow').all_inner_texts(); assert heads and heads[-1].startswith('Hoy') and any('semana' in h or 'mes' in h for h in heads), heads   # oldest first, by the day it was reported
    expect(pg.locator('.fchips .fchip')).to_have_count(1); pg.click('[data-go=filter]'); pg.click('.sheet [data-group=by]'); pg.click('.sheet [data-act="1"]')
    assert all(h.startswith('Reportó') or h.startswith('Del plan') for h in pg.locator('#pl-items .eyebrow').all_inner_texts())
    pg.click('.mbar a:has-text("Atrasados")'); expect(pg.locator('.fchips .fchip')).to_have_count(1)     # the order goes with you to the next list
    pg.click('.fchips [data-clear=sort]'); expect(pg.locator('.fchips')).to_have_count(0)
    pg.click('[data-go=menu]'); pg.click('.sheet .mfold .rowlink:has-text("Viñedo")'); n1 = pg.locator('#pl-items .card').count(); pg.fill('#pl-add', 'Poste 7 inclinado'); pg.keyboard.press('Enter')
    expect(pg.locator('#pl-items .card')).to_have_count(n1 + 1); t = api_task(pg, pg.locator('#pl-items .card:has-text("Poste 7")').get_attribute('data-tid')); assert t['area_name'] == 'Viñedo', t
    step('type and Enter adds to the Bandeja or to an area; filter and sort on every list: oldest first, who reported; the order follows from list to list')
    # the + beside a day reports something for that day
    pg.goto(BASE + '/#/semana'); pg.wait_for_timeout(600); plus = pg.locator('.mday .dayhead a.pb').last; day = re.search(r'fecha=(\d{4}-\d\d-\d\d)', plus.get_attribute('href')).group(1)
    plus.click(); expect(pg.locator('.top.sub h1')).to_have_text('Reportar'); expect(pg.locator('#r-due')).to_have_value(day); expect(pg.locator('.fixed')).to_be_visible()
    pg.fill('#r-title', 'Barnizar la puerta de la capilla'); area(pg, '#r-area', 'Capilla'); pg.click('#r-send')
    expect(pg.locator('.sent h1')).to_have_text('Reporte enviado', timeout=15000); expect(pg.locator('.sent')).not_to_contain_text('Bandeja')
    nid = re.search(r'#/enviado/(\d+)', pg.url).group(1); assert api_task(pg, nid)['due_date'] == day
    # a normal report with no day waits in the Bandeja
    pg.goto(BASE + '/#/nuevo'); pg.fill('#r-title', 'Cambiar el tapete de la entrada'); area(pg, '#r-area', 'Restaurante'); pg.click('#r-send')
    expect(pg.locator('.sent')).to_contain_text('Está en la Bandeja'); pg.click('.sent a:has-text("Ir a la Bandeja")'); expect(head(pg)).to_contain_text('Bandeja')
    expect(pg.locator('#pl-items .card:has-text("Cambiar el tapete")')).to_have_count(1)
    step('the + beside a day reports for that day; a report without a day lands in the Bandeja')
    # a place that is not on the list: "Otro lugar" asks for it in writing, and it travels with that pendiente only
    pg.goto(BASE + '/#/nuevo'); pg.fill('#r-title', 'Reja suelta en la caseta'); expect(pg.locator('#r-area-other')).to_be_hidden()
    pg.select_option('#r-area', 'otro'); expect(pg.locator('#r-area-other')).to_be_visible(); pg.click('#r-send'); expect(pg.locator('.ferr')).to_have_text('Escribe el lugar')
    pg.fill('#r-area-other', 'Caseta de la entrada'); pg.click('#r-send'); expect(pg.locator('.sent h1')).to_have_text('Reporte enviado', timeout=15000)
    oid = re.search(r'#/enviado/(\d+)', pg.url).group(1); t = api_task(pg, oid); assert t['place'] == 'Caseta de la entrada' and t['area_id'] is None, t
    pg.goto(BASE + '/#/bandeja'); expect(pg.locator('#pl-items .card:has-text("Reja suelta") .tag')).to_have_text('Caseta de la entrada')
    pg.goto(BASE + '/#/p/' + oid); expect(pg.locator('.cell:has-text("Dónde") .tag')).to_have_text('Caseta de la entrada')
    pg.click('.cell [data-set=area]'); expect(pg.locator('.sheet .opt.on')).to_contain_text('Otro lugar'); expect(pg.locator('.sheet .opt:has-text("a la lista")')).to_have_count(0)   # only administrators add to the list
    pg.click('.sheet .opt:has-text("Otro lugar")'); pg.fill('#sh-in', 'Caseta de vigilancia'); pg.click('.sheet [data-act="1"]'); expect(toast(pg)).to_contain_text('Lugar: Caseta de vigilancia')
    expect(pg.locator('.cell:has-text("Dónde") .tag')).to_have_text('Caseta de vigilancia')
    pg.click('.cell [data-set=area]'); pg.click('.sheet .opt:has-text("Jardín")'); expect(pg.locator('.cell:has-text("Dónde") .tag')).to_have_text('Jardín y huerta')
    t = api_task(pg, oid); assert t['place'] is None and t['area_id'], t                      # an area from the list takes the written place's spot
    pg.click('#toast.show [data-undo], #toast.show button'); pg.wait_for_timeout(700); t = api_task(pg, oid); assert t['place'] == 'Caseta de vigilancia' and t['area_id'] is None, t
    step('"Otro lugar": a written place instead of an area; it shows on the card and the pendiente, can be rewritten, and gives way to an area')
    # the month: a calendar with a bar per pendiente, then the days that have something; a day opens in Día
    today = dt.date.today(); ym = today.strftime('%Y-%m'); MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    pg.goto(BASE + '/#/'); pg.wait_for_timeout(500); h0 = pg.evaluate('history.length'); pg.click('.mbar a:has-text("Mes")'); expect(tab(pg)).to_have_text('Mes'); assert pg.evaluate('history.length') == h0
    expect(head(pg)).to_have_text('%s %d' % (MES[today.month - 1], today.year)); expect(pg.locator('.mcell.today .dn')).to_have_text(str(today.day))
    import calendar; assert pg.locator('.mcell:not(.out)').count() == calendar.monthrange(today.year, today.month)[1]
    assert pg.locator('.mcell.today .bars i').count() >= 1; expect(pg.locator('.mday').first.locator('.tpill')).to_have_text('Hoy')
    assert pg.evaluate("document.documentElement.scrollWidth <= innerWidth")                               # nothing slides sideways
    pg.click('.mh [data-step="1"]'); nxt = (today.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
    expect(head(pg)).to_have_text('%s %d' % (MES[nxt.month - 1], nxt.year)); expect(pg.locator('.mcell.today')).to_have_count(0)
    expect(pg.locator('.prow').first).to_be_visible(); assert pg.locator('.mcell .bars i.plan').count() >= 1    # preventive visits to come show before they are pendientes
    pg.click('.mcell[data-day="%s"] .dn' % nxt.replace(day=15).isoformat()); expect(tab(pg)).to_have_text('Día'); expect(pg.locator('.wstrip [aria-pressed="true"]')).to_have_attribute('data-day', nxt.replace(day=15).isoformat())
    pg.click('.mbar a:has-text("Mes")'); expect(head(pg)).to_have_text('%s %d' % (MES[nxt.month - 1], nxt.year)); pg.click('.mh [data-step="0"]'); expect(pg.locator('.mcell.today')).to_have_count(1)
    pg.click('.mbar a:has-text("Día")'); expect(pg.locator('.wstrip .today')).to_have_attribute('aria-pressed', 'true')
    step('phone: Mes is a calendar with a bar per pendiente and the days below; next month shows the preventive visits to come; a day opens in Día')
    c.close()

    # ---------- 6. Adrián (admin): preventive plan, equipment, service, contact, areas, people ----------
    c = ctx(SIDS[1]); pg = c.new_page(); watch(pg)
    pg.goto(BASE + '/#/preventivo'); expect(head(pg)).to_have_text('Preventivo')
    expect(pg.locator('.month[id^="m-"]')).to_have_count(12)
    # from July on the page continues into next year, up to the month before this one: always a year ahead in view
    mx_month = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)).month
    expect(pg.locator('.month[id^="n-"]')).to_have_count(mx_month - 1 if mx_month >= 7 else 0)
    pg.click('.hbtn'); expect(pg.locator('.top.sub h1')).to_have_text('Programar')
    pg.click('#pf-save'); expect(pg.locator('.ferr')).to_have_text('Escribe qué hay que hacer')
    pg.fill('#pf-title', 'Lavar cisterna y tinacos')
    pg.click('[data-choice="pf-freq"] .ch:has-text("3 veces al año")'); expect(pg.locator('.mo.on')).to_have_count(3)
    pg.click('.mo:not(.on) >> nth=0'); expect(pg.locator('.mo.on')).to_have_count(4)
    expect(pg.locator('[data-choice="pf-freq"] .ch.on')).to_have_text('4 veces al año')
    expect(pg.locator('#pf-sum')).to_contain_text('4 veces al año')
    area(pg, '#pf-area', 'Instalaciones')
    pg.select_option('#pf-who', label='Chuy Hernández (Plomería)'); pg.click('#pf-save')
    expect(head(pg)).to_have_text('Preventivo'); expect(pg.locator('body')).to_contain_text('Lavar cisterna y tinacos')
    step('new plan: N times a year by tapping months')
    pg.goto(BASE + '/#/planes'); pg.click('.lrow:has-text("Lavar cisterna")'); expect(pg.locator('.hero h2')).to_have_text('Lavar cisterna y tinacos')
    pg.click('[data-run]'); expect(pg.locator('.top.sub h1')).to_contain_text('Pendiente #'); expect(pg.locator('.hmeta')).to_contain_text('Preventivo')
    step('"Hacerlo ya" puts the plan\'s next job in Pendientes')
    pg.goto(BASE + '/#/plan/nuevo'); pg.fill('#pf-title', 'Revisar cloro de la alberca'); pg.click('[data-choice="pf-freq"] .ch:has-text("Cada cierto tiempo")')
    expect(pg.locator('#pf-every')).to_be_visible(); expect(pg.locator('#pf-months')).to_be_hidden(); pg.fill('#pf-n', '2'); expect(pg.locator('#pf-sum')).to_contain_text('Cada 2 semanas')
    pg.click('[data-choice="pf-freq"] .ch:has-text("Una sola vez")'); expect(pg.locator('#pf-sum')).to_contain_text('Una sola vez')
    step('plan form switches between months, every N, and once')

    pg.goto(BASE + '/#/equipos'); expect(head(pg)).to_have_text('Equipos'); expect(pg.locator('.lrow.eq').first).to_be_visible()
    pg.click('.hbtn'); pg.click('#ef-save'); expect(pg.locator('#ef-err')).to_contain_text('nombre')
    pg.set_input_files('#ef-pick-gal', JPG_PATH); pg.fill('#ef-name', 'Cava de vinos del restaurante')
    area(pg, '#ef-area', 'Restaurante'); pg.fill('#ef-model', 'Vinoteca Whirlpool WX-40')
    pg.select_option('#ef-who', label='Anselmo Rivas (Refrigeración)')
    pg.click('[data-choice="ef-freq"] .ch:has-text("2 veces al año")'); expect(pg.locator('.mo.on')).to_have_count(2)
    pg.fill('#ef-last', '2026-05-10'); pg.click('#ef-save')
    expect(pg.locator('.hero h2')).to_have_text('Cava de vinos del restaurante', timeout=15000)
    expect(pg.locator('.cover img')).to_be_visible(); expect(pg.locator('.svc')).to_contain_text('Último servicio'); expect(pg.locator('.hist li')).to_have_count(1)
    expect(pg.locator('.lrow:has-text("Servicio: Cava de vinos")')).to_be_visible()
    step('new equipment: photo, who looks after it, service plan and last service in one form')
    pg.click('.actionbar a:has-text("Anotar servicio")'); expect(pg.locator('.top.sub h1')).to_have_text('Anotar servicio')
    pg.fill('#sf-title', 'Limpieza de condensador'); pg.fill('#sf-cost', '900'); pg.click('#sf-save')
    expect(pg.locator('.hist li')).to_have_count(2); expect(pg.locator('.hist li').first).to_contain_text('Limpieza de condensador'); expect(pg.locator('.svc')).to_contain_text('Hoy')
    step('log a service: it becomes the latest line of the history')
    pg.click('.actionbar a:has-text("Reportar falla")'); expect(pg.locator('.fixed')).to_contain_text('Cava de vinos'); pg.fill('#r-title', 'No baja de 16 grados'); pg.click('#r-send')
    expect(pg.locator('.sent h1')).to_have_text('Reporte enviado'); pg.click('.sent a:has-text("Ver el reporte")'); expect(pg.locator('.cell:has-text("Equipo") .cv')).to_have_text('Cava de vinos del restaurante')
    step('report a fault from the equipment: equipment and area come filled in')

    pg.goto(BASE + '/#/contactos'); pg.click('.hbtn'); pg.click('#cf-save'); expect(pg.locator('#cf-err')).to_contain_text('nombre')
    pg.fill('#cf-name', 'Beto Salinas'); pg.fill('#cf-spec', 'Gas'); pg.fill('#cf-phone', '4155550111'); pg.click('#cf-save')
    expect(head(pg)).to_have_text('Contactos'); expect(pg.locator('.lrow.person:has-text("Beto Salinas")')).to_have_count(1)
    pg.fill('#ct-q', 'gas'); expect(pg.locator('.lrow.person')).to_have_count(1)
    pg.click('.lrow.person .pmain'); expect(pg.locator('.who-card h2')).to_have_text('Beto Salinas'); expect(pg.locator('.phone')).to_have_text('415 555 0111')
    pg.click('.top.sub a[aria-label=Editar]'); pg.fill('#cf-company', 'Gas Express'); pg.click('#cf-save'); expect(pg.locator('.who-card .by')).to_contain_text('Gas Express')
    step('new contact; search by trade')

    pg.goto(BASE + '/#/areas'); expect(pg.locator('.lrow.area').first).to_be_visible(); n_ar = pg.locator('.lrow.area').count(); pg.click('[data-new]'); pg.fill('#sh-in', 'Estacionamiento'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.lrow.area')).to_have_count(n_ar + 1)
    pg.click('.lrow.area:has-text("Estacionamiento") .pmain'); pg.click('.cdot.c-cyan'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.lrow.area:has-text("Estacionamiento") .tag')).to_have_class(re.compile('c-cyan'))
    pg.click('.lrow.area:has-text("Estacionamiento") [data-dir="-1"]'); pg.wait_for_timeout(700)
    assert pg.locator('.lrow.area').nth(n_ar - 1).inner_text().startswith('Estacionamiento')
    step('areas: add, recolour, reorder')
    # an administrator turns a written place into an area of the list, from the pendiente
    oid = pg.evaluate("() => fetch('/api/tasks?view=open').then((r) => r.json()).then((d) => (d.tasks.find((t) => t.place === 'Caseta de vigilancia') || {}).id)")
    assert oid, 'the pendiente with a written place'
    pg.goto(BASE + '/#/p/' + str(oid)); pg.click('.cell [data-set=area]'); pg.click('.sheet .opt:has-text("a la lista")')
    expect(pg.locator('#sh-in')).to_have_value('Caseta de vigilancia'); pg.fill('#sh-in', 'Caseta'); pg.click('.sheet [data-act="1"]')
    expect(toast(pg)).to_contain_text('Área nueva: Caseta'); expect(pg.locator('.cell:has-text("Dónde") .tag')).to_have_text('Caseta')
    t = api_task(pg, oid); assert t['place'] is None and t['area_name'] == 'Caseta', t
    pg.goto(BASE + '/#/nuevo'); assert 'Caseta' in pg.locator('#r-area').inner_text()
    step('an administrator adds a written place to the list of areas from the pendiente')
    pg.goto(BASE + '/#/personas'); expect(pg.locator('[data-signup]')).to_have_attribute('aria-checked', 'true')
    pg.click('[data-signup]'); expect(pg.locator('[data-signup]')).to_have_attribute('aria-checked', 'false')
    c2 = ctx(); p2 = c2.new_page(); p2.goto(BASE + '/'); p2.fill('#en-name', 'Persona Nueva'); p2.fill('#en-phone', '4155550555'); p2.click('#en-go')
    expect(p2.locator('#en-err')).to_contain_text('registro está cerrado')
    p2.fill('#en-phone', '415 555 0199'); p2.click('#en-go'); expect(tab(p2)).to_have_text('Día')    # Rosa is already registered: she still gets in
    c2.close()
    pg.click('[data-signup]'); expect(pg.locator('[data-signup]')).to_have_attribute('aria-checked', 'true')
    pg.click('.lrow:has-text("Rosa Méndez")'); pg.click('.sheet .opt:has-text("Quitarle el acceso")'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.lrow:has-text("Rosa Méndez")')).to_contain_text('Sin acceso')
    step('people: close and reopen sign-up; remove someone')
    pg.goto(BASE + '/#/resumen'); expect(pg.locator('.chart .wk')).to_have_count(8); pg.click('.lrow[data-who] >> nth=0'); expect(head(pg)).to_contain_text('Todo'); expect(pg.locator('.fchip')).to_have_count(1)
    pg.click('.fchip')
    pg.goto(BASE + '/#/buscar'); pg.fill('#s-q', 'canaleta'); expect(pg.locator('#s-res .card')).to_have_count(1)
    step('summary drills into the list; search finds it')
    # delete as admin
    pg.click('#s-res .card .body'); pg.click('.sheet.tsheet [data-act="0"]'); expect(pg.locator('.top.sub h1')).to_contain_text('Pendiente #')
    pg.click('[data-menu]'); pg.click('.sheet .opt:has-text("Eliminar")'); pg.click('.sheet [data-act="1"]'); expect(toast(pg)).to_have_text('Eliminado')
    step('admin can delete')
    # sign out and back in
    pg.goto(BASE + '/#/cuenta'); pg.click('[data-out]'); pg.click('.sheet [data-act="1"]'); expect(pg.locator('.enter h1')).to_be_visible()
    pg.fill('#en-name', ''); pg.fill('#en-phone', '4155550142'); pg.fill('#en-email', ''); pg.click('#en-go'); expect(pg.locator('#en-err')).to_contain_text('administrador')
    pg.fill('#en-email', 'Adrian@Example.com'); pg.click('#en-go'); expect(tab(pg)).to_have_text('Día')
    step('sign out; an administrator needs the email too; back in')
    c.close()
    # ---------- wide screens: no side menu; lists on the left, the hours on the right, as in Horizonte ----------
    c = b.new_context(viewport={'width': 1440, 'height': 900}, locale='es-MX', timezone_id='America/Mexico_City')
    route_theme(c); c.add_cookies([cookie(SIDS[0])]); c.set_default_timeout(6000); pg = c.new_page(); watch(pg)
    pg.goto(BASE + '/'); expect(pg.locator('.dtop .zoom [aria-current]')).to_have_text('Día'); expect(pg.locator('.hours .grid')).to_have_count(2)
    expect(pg.locator('.hcol.today .num')).to_have_class(re.compile('today')); assert pg.locator('.panel .navrow').count() >= 12; expect(pg.locator('.mbar, .fab')).to_have_count(0)
    assert pg.evaluate("document.documentElement.scrollHeight <= innerHeight + 1")                          # the planner fills the window and scrolls inside
    pg.click('[data-go=panel]'); expect(pg.locator('.panel')).to_be_hidden(); pg.click('[data-go=panel]'); expect(pg.locator('.panel')).to_be_visible()
    pg.click('.dtop [data-step="1"]'); expect(pg.locator('.hcol.today')).to_have_count(0); pg.click('.dtop [data-step="0"]'); expect(pg.locator('.hcol.today')).to_have_count(1)
    # under the priorities, "Áreas" opens to show where the open work is
    expect(pg.locator('.panel [data-go=areas]')).to_have_attribute('aria-expanded', 'false'); expect(pg.locator('.panel .navrow[data-src^=a]:not([data-src=all])')).to_have_count(0)
    pg.click('.panel [data-go=areas]'); n_ar = pg.evaluate("S.areas.filter((a) => a.active).length + (C.open.some((t) => !t.area_id) ? 1 : 0)")
    expect(pg.locator('.panel .navrow[data-src^=a]:not([data-src=all])')).to_have_count(n_ar); pg.reload(); expect(pg.locator('.panel [data-go=areas]')).to_have_attribute('aria-expanded', 'true')   # and stays open
    pg.click('.panel .navrow:has-text("Restaurante")'); expect(pg.locator('.listtitle b')).to_have_text('Restaurante'); assert pg.locator('.panel .card').count() >= 1; pg.click('.panel [data-src=""]')
    pg.click('.panel [data-src=p1]'); expect(pg.locator('.listtitle b')).to_have_text('Urgente'); assert pg.locator('.panel .card').count() == pg.locator('.panel .card.p1').count() > 0
    pg.click('.panel [data-src=""]'); pg.fill('#pl-q', 'regadera'); expect(pg.locator('.listtitle b')).to_have_text('Todo'); expect(pg.locator('.panel .card')).to_have_count(1); expect(pg.locator('#pl-q')).to_be_focused()
    pg.click('.panel [data-src=""]'); expect(pg.locator('.panel [data-src=inbox]')).to_be_visible(); assert pg.locator('.panel .navrow').count() == 12 + n_ar
    pg.click('.dtop [data-go=contacts]'); expect(pg.locator('.sheet.csheet h2')).to_have_text('Contactos'); pg.keyboard.press('Escape'); expect(pg.locator('#sheet')).to_be_hidden()
    pg.click('.panel a.navrow:has-text("Equipos")'); expect(head(pg)).to_have_text('Equipos'); expect(pg.locator('.dtop')).to_be_visible(); expect(pg.locator('.panel')).to_have_count(0)
    pg.click('.dtop .zoom a:has-text("Semana")'); expect(pg.locator('.hours.n7 .grid')).to_have_count(7)
    step('wide: top bar, panel of lists, priorities and tableros, two days of hours; Equipos is a page; no side menu')
    # something without a day to plan
    new = pg.evaluate("fetch('/api/tasks', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({title: 'Pintar la reja del huerto', priority: 3})}).then((r) => r.json())")
    assert new['task']['due_date'] is None, new                                                             # a normal report waits in the Bandeja
    pg.reload(); expect(pg.locator('.hours.n7 .grid')).to_have_count(7); pg.wait_for_timeout(500)
    pg.click('.panel [data-src=inbox]'); expect(pg.locator('.listtitle b')).to_have_text('Bandeja')
    def pull(box, x2, y2):
        pg.mouse.move(box['x'] + 60, box['y'] + 10); pg.mouse.down(); pg.mouse.move(box['x'] + 76, box['y'] + 26, steps=3); pg.mouse.move(x2, y2, steps=8); pg.mouse.up(); pg.wait_for_timeout(500)
    def slot(day, hour): col = pg.locator('.hours .grid').nth(day).bounding_box(); return col['x'] + col['width'] / 2, col['y'] + (hour - 6) * 52 + 2
    tid = str(new['task']['id']); card = pg.locator('.panel .card[data-tid="%s"]' % tid); expect(card).to_be_visible(); n_cards = pg.locator('.panel .card').count()
    load0 = pg.locator('.hcol').nth(2).inner_text()
    pull(card.bounding_box(), *slot(2, 10))
    blk = pg.locator('.grid .card.blk[data-tid="%s"]' % tid); expect(blk.locator('.meta')).to_have_text('10:00 a 11:00'); expect(pg.locator('.panel .card')).to_have_count(n_cards - 1)
    t = api_task(pg, tid); assert t['plan_min'] == 600 and t['est_min'] == 60 and t['due_date'], t
    bb = blk.bounding_box(); pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] - 3); pg.mouse.down(); pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] + 49, steps=5); pg.mouse.up()
    expect(blk.locator('.meta')).to_have_text('10:00 a 12:00'); pg.wait_for_timeout(500)
    load1 = pg.locator('.hcol').nth(2).inner_text(); assert ' h' in load1 and load1 != load0, (load0, load1)                # the day's load in its heading
    pull(blk.bounding_box(), *slot(4, 15)); expect(pg.locator('.hours .grid').nth(4).locator('.card.blk[data-tid="%s"]' % tid)).to_be_visible()
    # a click opens its sheet over the calendar
    blk.locator('.body').click(); sh = pg.locator('.sheet.tsheet'); expect(sh.locator('h2')).to_have_text('Pintar la reja del huerto'); expect(sh.locator('.stepper div')).to_have_text('2 h'); expect(sh.locator('#ts-time')).to_have_value('14:45')     # it keeps the spot it was grabbed by
    assert '#/semana' in pg.url; pg.keyboard.press('Escape'); expect(pg.locator('#sheet')).to_be_hidden(); pg.wait_for_timeout(300)
    # onto a day without an hour, then back onto the list
    uc = pg.locator('.hours .ucol').nth(5).bounding_box(); pull(pg.locator('.grid .card.blk[data-tid="%s"]' % tid).bounding_box(), uc['x'] + uc['width'] / 2, uc['y'] + 12)
    expect(pg.locator('.hours .ucol').nth(5).locator('.card[data-tid="%s"]' % tid)).to_be_visible(); t = api_task(pg, tid); assert t['plan_min'] is None and t['due_date'], t
    lb = pg.locator('.panel').bounding_box(); pull(pg.locator('.ucol .card[data-tid="%s"]' % tid).bounding_box(), lb['x'] + 120, lb['y'] + 420)
    expect(pg.locator('.hours .card[data-tid="%s"]' % tid)).to_have_count(0); expect(pg.locator('.panel .card[data-tid="%s"]' % tid)).to_be_visible(); expect(toast(pg)).to_have_text('Volvió a la Bandeja')
    # a person's week: what has no owner and is dropped into it becomes theirs
    pg.select_option('#pl-who', label='Adrián Robles'); pg.wait_for_timeout(300); pull(pg.locator('.panel .card[data-tid="%s"]' % tid).bounding_box(), *slot(3, 9))
    expect(toast(pg)).to_have_text('Asignado a Adrián'); t = api_task(pg, tid); assert t['provider_name'] == 'Adrián Robles' and t['plan_min'] == 540, t
    pg.select_option('#pl-who', 'all')
    pg.click('.dtop .zoom a:has-text("Día")'); expect(pg.locator('.hours.n2 .grid')).to_have_count(2); expect(pg.locator('.hours .ucol .card.in-day').first).to_be_visible()
    step('wide: drag from a list onto a day and hour, stretch, move, open its sheet, a day without hour, back to the Bandeja, into a person\'s week')
    # the month on a wide screen: every day lists its pendientes by name; drop one on another day and it moves there with its hour
    pg.click('.dtop .zoom a:has-text("Mes")'); expect(pg.locator('.dtop .zoom [aria-current]')).to_have_text('Mes'); expect(pg.locator('.mesv .mcell.today')).to_have_count(1)
    expect(pg.locator('.dtitle .lg')).to_have_text('%s %d' % (MES[today.month - 1], today.year)); assert pg.evaluate("document.documentElement.scrollHeight <= innerHeight + 1")
    chip = pg.locator('.mcell .card.in-chip[data-tid]').first; mid = chip.get_attribute('data-tid'); before = api_task(pg, mid)
    dest = (today + dt.timedelta(days=2)).isoformat() if (today + dt.timedelta(days=2)).month == today.month else (today - dt.timedelta(days=2)).isoformat()
    if dest == before['due_date']: dest = (dt.date.fromisoformat(dest) + dt.timedelta(days=1)).isoformat()
    cb = pg.locator('.mcell[data-day="%s"]' % dest).bounding_box(); pull(chip.bounding_box(), cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] - 14)
    expect(pg.locator('.mcell[data-day="%s"] .card[data-tid="%s"]' % (dest, mid))).to_be_visible(); expect(toast(pg)).to_contain_text('Quedó para')
    t = api_task(pg, mid); assert t['due_date'] == dest and t['plan_min'] == before['plan_min'], (t['due_date'], t['plan_min'], before['plan_min'])
    if pg.locator('.panel [data-src=""]').count(): pg.click('.panel [data-src=""]')
    pg.click('.panel [data-src=inbox]'); row = pg.locator('.panel .card[data-tid]').first; rid2 = row.get_attribute('data-tid')
    pull(row.bounding_box(), cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] - 14); pg.wait_for_timeout(500); t = api_task(pg, rid2); assert t['due_date'] == dest and t['plan_min'] is None, t
    pg.locator('.mcell[data-day="%s"] .card[data-tid="%s"] .body' % (dest, mid)).click(); expect(pg.locator('.sheet.tsheet')).to_be_visible(); pg.keyboard.press('Escape')
    pg.click('.dtop [data-step="1"]'); expect(pg.locator('.dtitle .lg')).to_have_text('%s %d' % (MES[nxt.month - 1], nxt.year)); expect(pg.locator('.mcell .card.plan').first).to_be_visible()
    pg.click('.dtop [data-step="0"]'); pg.click('.mcell[data-day="%s"] .dn' % dest); expect(pg.locator('.dtop .zoom [aria-current]')).to_have_text('Día'); expect(pg.locator('.hours .hcol').first).to_have_attribute('data-day', dest)
    step('wide: Mes lists each day\'s pendientes; one dropped on another day moves there and keeps its hour; from a list it gets the day; a day opens in Día')
    c.close()
    # ---------- on a phone: hold a pendiente, a day slides in, drop it on an hour (the edge changes the day) ----------
    c = ctx(SIDS[0]); pg = c.new_page(); watch(pg); cdp = c.new_cdp_session(pg)
    def finger(kind, x=0, y=0): cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})
    pg.goto(BASE + '/#/bandeja'); expect(head(pg)).to_contain_text('Bandeja'); pg.wait_for_timeout(800)
    row = pg.locator('#pl-items .card .body').first; rid = row.locator('xpath=..').get_attribute('data-tid'); bb = row.bounding_box()
    finger('touchStart', bb['x'] + 80, bb['y'] + 14); pg.wait_for_timeout(500); expect(pg.locator('.ddrop.in')).to_have_count(1)
    day0 = pg.locator('.ddrop').get_attribute('data-day'); sc = pg.locator('.dd-scroll').bounding_box()
    for i in range(1, 5): finger('touchMove', bb['x'] + 80 + i * 20, bb['y'] + 14 + i * 40); pg.wait_for_timeout(30)
    expect(pg.locator('.dd-hint')).to_be_visible(); title0 = pg.locator('.dd-title b').inner_text()
    finger('touchMove', 386, sc['y'] + 200); pg.wait_for_timeout(300); expect(pg.locator('.ddrop.edge-r')).to_have_count(1)      # the edge lights up first
    pg.wait_for_function("(d) => document.querySelector('.ddrop').dataset.day > d", arg=day0, timeout=3000)
    assert pg.locator('.dd-win .out').count() == 2 and pg.locator('.dd-grid.from-r').count() == 1                                # the day slides: one leaving, one arriving
    pg.wait_for_timeout(600); day1 = pg.locator('.ddrop').get_attribute('data-day'); assert day1 > day0
    assert pg.locator('.dd-win .out').count() == 0 and pg.locator('.dd-grid').count() == 1 and pg.locator('.dd-title b').inner_text() != title0
    assert pg.evaluate("localStorage.getItem('mt_edge')")                                                                         # the hint about the edges has done its job
    finger('touchMove', 220, sc['y'] + 220); pg.wait_for_timeout(120); expect(pg.locator('.dd-prev')).to_be_visible(); finger('touchEnd'); pg.wait_for_timeout(800)
    expect(pg.locator('#toast')).to_contain_text('Quedó para'); expect(pg.locator('.ddrop')).to_have_count(0); expect(pg.locator('#sheet')).to_be_hidden()
    t = api_task(pg, rid); assert t['due_date'] == day1 and t['plan_min'] is not None and t['est_min'], t
    expect(pg.locator('#pl-items .card[data-tid="%s"]' % rid)).to_have_count(0)                               # it left the Bandeja
    pg.click('.mbar a:has-text("Día")'); pg.click('.wstrip button[data-day="%s"]' % day1) if pg.locator('.wstrip button[data-day="%s"]' % day1).count() else pg.click('.mbar a:has-text("Semana")')
    expect(pg.locator('.card[data-tid="%s"]' % rid).first).to_be_visible()
    step('phone: hold a pendiente in the Bandeja and drop it on a day and hour; it shows on that day')
    c.close()
    # nothing answers without a session
    c = ctx(); pg = c.new_page(); pg.goto(BASE + '/')
    for path in ['/bootstrap', '/tasks', '/photos/1', '/equipment', '/providers', '/pm/year', '/summary', '/search?q=a']:
        assert pg.evaluate("(p) => fetch('/api' + p).then((r) => r.status)", path) == 401, path
    step('every API route asks for a signed-up person')
    c.close(); b.close()
print(f'\n{len(ok)} flows passed'); print('JS errors:', errs if errs else 'none')
