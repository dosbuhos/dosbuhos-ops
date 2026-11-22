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

    # ---------- 1. sign up ----------
    c = ctx(); pg = c.new_page(); watch(pg)
    pg.goto(BASE + '/#/p/9')                       # deep link while signed out
    expect(pg.locator('.enter h1')).to_have_text('Mantenimiento')
    pg.click('#en-go'); expect(pg.locator('#en-err')).to_contain_text('nombre')
    pg.fill('#en-phone', '415 555 0199'); pg.click('#en-go'); expect(pg.locator('#en-err')).to_have_text('Escribe tu nombre y apellido')   # new phone, no name
    pg.fill('#en-name', 'Rosa Méndez'); pg.fill('#en-phone', '415 12'); pg.click('#en-go')
    expect(pg.locator('#en-err')).to_contain_text('10 dígitos')
    pg.fill('#en-phone', '415 555 0199'); pg.click('#en-go')
    expect(pg.locator('.top.sub h1')).to_have_text('Pendiente #9')   # lands on the link she opened
    step('sign-up with name + WhatsApp, lands on the deep link')
    pg.goto(BASE + '/'); expect(pg.locator('.top h1')).to_have_text('Pendientes')
    assert pg.locator('.row').count() >= 8
    step('Pendientes lists the open work')

    # ---------- 2. report with a photo ----------
    pg.click('.nav .nv.report'); expect(pg.locator('.top.sub h1')).to_have_text('Reportar')
    pg.click('#r-send'); expect(pg.locator('.ferr')).to_have_text('Escribe qué pasa')
    pg.fill('#r-title', 'Se cayó la canaleta de la entrada')
    pg.click('#r-send'); expect(pg.locator('.ferr')).to_have_text('Elige dónde está el problema')
    pg.click('[data-choice="r-area"] .ch:has-text("Instalaciones")')
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
    expect(pg.locator('.cell:has-text("Fecha") .due')).to_have_text('Para hoy')
    tid = int(re.search(r'#/p/(\d+)', pg.url).group(1))
    step('the report opens with its photo and a date for today')
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
    expect(pg.locator('.timeline .note .nt').last).to_have_text('Se cambió la pieza')
    pg.click('[data-reopen]'); expect(pg.locator('.cell:has-text("Estado") .pill')).to_have_text('Por hacer')
    step('mark done with a note and a photo; reopen')

    # ---------- 5. list: tiles, filter, group, tick ----------
    pg.goto(BASE + '/#/'); expect(pg.locator('.top h1')).to_have_text('Pendientes'); pg.wait_for_timeout(900)
    n_all = pg.locator('.row').count()
    pg.click('.tile[data-quick=late]'); late = pg.locator('.row').count(); assert 0 < late < n_all, (late, n_all)
    assert pg.locator('.row:not(.late)').count() == 0
    pg.click('.tile[data-quick=late]'); assert pg.locator('.row').count() == n_all
    pg.click('[data-filter]'); pg.click('.sheet [data-area]:has-text("Restaurante")'); pg.click('.sheet [data-group=area]'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.fchip')).to_have_count(1); assert pg.locator('h2.sec .tag').count() == 1
    pg.reload(); expect(pg.locator('.fchip')).to_have_count(1)          # the filter is remembered
    pg.click('.fchip'); expect(pg.locator('.fchip')).to_have_count(0)
    pg.click('[data-filter]'); pg.click('.sheet [data-who=mine]'); expect(pg.locator('.sheet [data-who=mine]')).to_have_attribute('aria-pressed', 'true'); pg.click('.sheet [data-act="0"]')
    expect(pg.locator('.fchip')).to_have_count(0)
    step('tiles filter the list; area filter + grouping persist; filters clear')
    first_title = pg.locator('.row .chk[data-done]').first.get_attribute('aria-label')
    pg.locator('.row .chk[data-done]').first.click(); expect(pg.locator('.sheet h2')).to_have_text('Marcar hecho'); pg.click('.sheet [data-act="1"]')
    expect(toast(pg)).to_contain_text('Hecho'); pg.wait_for_timeout(600); assert pg.locator('.row').count() == n_all - 1
    pg.click('#toast button'); pg.wait_for_timeout(900); assert pg.locator('.row').count() == n_all
    step('tick a row → done in two taps, with undo')
    c.close()

    # ---------- 6. Adrián (admin): preventive plan, equipment, service, contact, areas, people ----------
    c = ctx(SIDS[1]); pg = c.new_page(); watch(pg)
    pg.goto(BASE + '/#/preventivo'); expect(pg.locator('.top h1')).to_have_text('Preventivo')
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
    pg.click('[data-choice="pf-area"] .ch:has-text("Instalaciones")')
    pg.select_option('#pf-who', label='Chuy Hernández · Plomería'); pg.click('#pf-save')
    expect(pg.locator('.top h1')).to_have_text('Preventivo'); expect(pg.locator('body')).to_contain_text('Lavar cisterna y tinacos')
    step('new plan: N times a year by tapping months')
    pg.goto(BASE + '/#/planes'); pg.click('.lrow:has-text("Lavar cisterna")'); expect(pg.locator('.hero h2')).to_have_text('Lavar cisterna y tinacos')
    pg.click('[data-run]'); expect(pg.locator('.top.sub h1')).to_contain_text('Pendiente #'); expect(pg.locator('.hmeta')).to_contain_text('Preventivo')
    step('"Hacerlo ya" puts the plan\'s next job in Pendientes')
    pg.goto(BASE + '/#/plan/nuevo'); pg.fill('#pf-title', 'Revisar cloro de la alberca'); pg.click('[data-choice="pf-freq"] .ch:has-text("Cada cierto tiempo")')
    expect(pg.locator('#pf-every')).to_be_visible(); expect(pg.locator('#pf-months')).to_be_hidden(); pg.fill('#pf-n', '2'); expect(pg.locator('#pf-sum')).to_contain_text('Cada 2 semanas')
    pg.click('[data-choice="pf-freq"] .ch:has-text("Una sola vez")'); expect(pg.locator('#pf-sum')).to_contain_text('Una sola vez')
    step('plan form switches between months, every N, and once')

    pg.goto(BASE + '/#/equipos'); expect(pg.locator('.top h1')).to_have_text('Equipos'); expect(pg.locator('.lrow.eq').first).to_be_visible()
    pg.click('.hbtn'); pg.click('#ef-save'); expect(pg.locator('#ef-err')).to_contain_text('nombre')
    pg.set_input_files('#ef-pick-gal', JPG_PATH); pg.fill('#ef-name', 'Cava de vinos del restaurante')
    pg.click('[data-choice="ef-area"] .ch:has-text("Restaurante")'); pg.fill('#ef-model', 'Vinoteca Whirlpool WX-40')
    pg.select_option('#ef-who', label='Anselmo Rivas · Refrigeración')
    pg.click('[data-choice="ef-freq"] .ch:has-text("2 veces al año")'); expect(pg.locator('.mo.on')).to_have_count(2)
    pg.fill('#ef-last', '2026-05-10'); pg.click('#ef-save')
    expect(pg.locator('.hero h2')).to_have_text('Cava de vinos del restaurante', timeout=15000)
    expect(pg.locator('.cover img')).to_be_visible(); expect(pg.locator('.svc')).to_contain_text('Último servicio'); expect(pg.locator('.hist li')).to_have_count(1)
    expect(pg.locator('.lrow:has-text("Servicio: Cava de vinos")')).to_be_visible()
    step('new equipment: photo, who looks after it, service plan and last service in one form')
    pg.click('.actionbar a:has-text("Anotar servicio")'); expect(pg.locator('.top.sub h1')).to_have_text('Anotar servicio')
    pg.fill('#sf-title', 'Limpieza de condensador'); pg.fill('#sf-cost', '900'); pg.click('#sf-save')
    expect(pg.locator('.hist li')).to_have_count(2); expect(pg.locator('.hist li').first).to_contain_text('Limpieza de condensador'); expect(pg.locator('.svc')).to_contain_text('hoy')
    step('log a service: it becomes the latest line of the history')
    pg.click('.actionbar a:has-text("Reportar falla")'); expect(pg.locator('.fixed')).to_contain_text('Cava de vinos'); pg.fill('#r-title', 'No baja de 16 grados'); pg.click('#r-send')
    expect(pg.locator('.sent h1')).to_have_text('Reporte enviado'); pg.click('.sent a:has-text("Ver el reporte")'); expect(pg.locator('.cell:has-text("Equipo") .cv')).to_have_text('Cava de vinos del restaurante')
    step('report a fault from the equipment: equipment and area come filled in')

    pg.goto(BASE + '/#/contactos'); pg.click('.hbtn'); pg.click('#cf-save'); expect(pg.locator('#cf-err')).to_contain_text('nombre')
    pg.fill('#cf-name', 'Beto Salinas'); pg.fill('#cf-spec', 'Gas'); pg.fill('#cf-phone', '4155550111'); pg.click('#cf-save')
    expect(pg.locator('.top h1')).to_have_text('Contactos'); expect(pg.locator('.lrow.person:has-text("Beto Salinas")')).to_have_count(1)
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
    pg.goto(BASE + '/#/personas'); expect(pg.locator('[data-signup]')).to_have_attribute('aria-checked', 'true')
    pg.click('[data-signup]'); expect(pg.locator('[data-signup]')).to_have_attribute('aria-checked', 'false')
    c2 = ctx(); p2 = c2.new_page(); p2.goto(BASE + '/'); p2.fill('#en-name', 'Persona Nueva'); p2.fill('#en-phone', '4155550555'); p2.click('#en-go')
    expect(p2.locator('#en-err')).to_contain_text('registro está cerrado')
    p2.fill('#en-phone', '415 555 0199'); p2.click('#en-go'); expect(p2.locator('.top h1')).to_have_text('Pendientes')    # Rosa is already registered: she still gets in
    c2.close()
    pg.click('[data-signup]'); expect(pg.locator('[data-signup]')).to_have_attribute('aria-checked', 'true')
    pg.click('.lrow:has-text("Rosa Méndez")'); pg.click('.sheet .opt:has-text("Quitarle el acceso")'); pg.click('.sheet [data-act="1"]')
    expect(pg.locator('.lrow:has-text("Rosa Méndez")')).to_contain_text('Sin acceso')
    step('people: close and reopen sign-up; remove someone')
    pg.goto(BASE + '/#/resumen'); expect(pg.locator('.chart .wk')).to_have_count(8); pg.click('.lrow[data-who] >> nth=0'); expect(pg.locator('.top h1')).to_have_text('Pendientes'); expect(pg.locator('.fchip')).to_have_count(1)
    pg.click('.fchip')
    pg.goto(BASE + '/#/buscar'); pg.fill('#s-q', 'canaleta'); expect(pg.locator('#s-res .row')).to_have_count(1)
    step('summary drills into the list; search finds it')
    # delete as admin
    pg.click('#s-res .row a'); pg.click('[data-menu]'); pg.click('.sheet .opt:has-text("Eliminar")'); pg.click('.sheet [data-act="1"]'); expect(toast(pg)).to_have_text('Eliminado')
    step('admin can delete')
    # sign out and back in
    pg.goto(BASE + '/#/cuenta'); pg.click('[data-out]'); pg.click('.sheet [data-act="1"]'); expect(pg.locator('.enter h1')).to_be_visible()
    pg.fill('#en-name', ''); pg.fill('#en-phone', '4155550142'); pg.fill('#en-email', ''); pg.click('#en-go'); expect(pg.locator('#en-err')).to_contain_text('administrador')
    pg.fill('#en-email', 'Adrian@Example.com'); pg.click('#en-go'); expect(pg.locator('.top h1')).to_have_text('Pendientes')
    step('sign out; an administrator needs the email too; back in')
    c.close()
    # nothing answers without a session
    c = ctx(); pg = c.new_page(); pg.goto(BASE + '/')
    for path in ['/bootstrap', '/tasks', '/photos/1', '/equipment', '/providers', '/pm/year', '/summary', '/search?q=a']:
        assert pg.evaluate("(p) => fetch('/api' + p).then((r) => r.status)", path) == 401, path
    step('every API route asks for a signed-up person')
    c.close(); b.close()
print(f'\n{len(ok)} flows passed'); print('JS errors:', errs if errs else 'none')
