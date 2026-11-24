"""Esmero with no signal: python3 test/offline.py (after seed.py, with wrangler dev running).
Opens the app once with signal, cuts the signal, reloads, reports with a photo, marks one done, writes a note,
then brings the signal back and checks that all of it reached the server."""
import sys, os, re, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright, expect
from _env import BASE, state, launch, route_theme, cookie
SIDS = state()['sids']; errs = []
JPG = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.photo.jpg')
if not os.path.exists(JPG):
    from PIL import Image; Image.new('RGB', (800, 600), (90, 140, 200)).save(JPG, quality=80)
def step(msg): print('  ✓', msg)
with sync_playwright() as p:
    b = launch(p)
    c = b.new_context(viewport={'width': 390, 'height': 780}, is_mobile=True, has_touch=True, locale='es-MX', timezone_id='America/Mexico_City')
    route_theme(c); c.add_cookies([cookie(SIDS[0])])
    pg = c.new_page()
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and 'Failed to load' not in m.text and 'ERR_INTERNET_DISCONNECTED' not in m.text else None)
    api = lambda path: pg.evaluate("(p) => fetch('/api' + p).then((r) => r.json())", path)

    pg.goto(BASE + '/?sw#/'); pg.evaluate("navigator.serviceWorker.ready"); pg.reload(); pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=10000)
    pg.goto(BASE + '/?sw#/bandeja'); pg.wait_for_timeout(800)
    tid = pg.locator('#pl-items .card[data-tid]').first.get_attribute('data-tid'); title = pg.locator(f'#pl-items .card[data-tid="{tid}"] .t').inner_text()
    pg.goto(BASE + f'/?sw#/p/{tid}'); pg.wait_for_timeout(800); pg.goto(BASE + '/?sw#/'); pg.wait_for_timeout(1500)
    step('opened with signal: the app and what it showed are kept on the phone')

    c.set_offline(True)
    pg.reload(); expect(pg.locator('.mbar')).to_be_visible(timeout=15000); expect(pg.locator('#net')).to_contain_text('Sin señal')
    pg.goto(BASE + '/?sw#/bandeja'); expect(pg.locator(f'#pl-items .card[data-tid="{tid}"]')).to_be_visible()
    step('no signal: it opens, says so, and shows the Bandeja as it was')

    pg.goto(BASE + '/?sw#/nuevo'); pg.fill('#r-title', 'Fuga en el riego de la huerta'); pg.set_input_files('#r-pick-gal', JPG)
    v = pg.evaluate("(() => { const o = [...document.querySelector('#r-area').options].find((x) => x.text.includes('Jardín')); return o.value; })()"); pg.select_option('#r-area', v)
    pg.click('#r-send'); expect(pg.locator('.sent .pendmsg')).to_be_visible(timeout=10000); expect(pg.locator('#net')).to_contain_text('2 cambios por enviar')
    pg.goto(BASE + '/?sw#/bandeja'); card = pg.locator('#pl-items .card:has-text("Fuga en el riego")'); expect(card).to_be_visible(); expect(card).to_contain_text('Por enviar')
    step('a report with a photo, made offline, is in the Bandeja marked "Por enviar"')

    card.locator('.body').click(); pg.click('.sheet [data-act="0"]'); expect(pg.locator('.pendmsg')).to_contain_text('1 foto')
    pg.fill('#d-note', 'Se cerró la llave mientras tanto'); pg.click('#d-send'); expect(pg.locator('.timeline .note:has-text("Se cerró la llave")')).to_be_visible()
    step('its page opens offline, says the photo waits, and takes a note')

    pg.goto(BASE + f'/?sw#/p/{tid}'); expect(pg.locator('.hero h2')).to_have_text(title); pg.click('[data-finish]'); pg.click('.sheet [data-act="1"]')
    pg.goto(BASE + '/?sw#/bandeja'); expect(pg.locator(f'#pl-items .card[data-tid="{tid}"]')).to_have_count(0); expect(pg.locator('#net')).to_contain_text('4 cambios')
    pg.reload(); expect(pg.locator('#net')).to_contain_text('4 cambios', timeout=15000); expect(pg.locator(f'#pl-items .card[data-tid="{tid}"]')).to_have_count(0); expect(pg.locator('#pl-items .card:has-text("Fuga en el riego")')).to_be_visible()
    step('marked done offline: it leaves the list, and all of it survives closing and opening the app')

    c.set_offline(False); pg.evaluate("window.dispatchEvent(new Event('online'))")
    expect(pg.locator('#toast')).to_contain_text('Se enviaron', timeout=20000); expect(pg.locator('#net')).not_to_have_class(re.compile('show'), timeout=10000)
    t = api(f'/tasks/{tid}')['task']; assert t['status'] == 'hecha', t['status']
    new = [x for x in api('/tasks?view=open')['tasks'] if x['title'] == 'Fuga en el riego de la huerta']; assert len(new) == 1, new
    d = api(f"/tasks/{new[0]['id']}"); assert len(d['photos']) == 1 and any('Se cerró la llave' in n['body'] for n in d['notes']) and d['task']['area_name'] == 'Jardín y huerta', d
    pg.goto(BASE + '/?sw#/bandeja'); expect(pg.locator('#pl-items .card:has-text("Fuga en el riego")')).not_to_contain_text('Por enviar')
    step('signal back: the report, its photo, the note and the "done" reach the server once each')
    b.close()
print('\nJS errors:', errs or 'none')
if errs: sys.exit(1)
