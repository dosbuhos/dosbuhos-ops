"""Made-up people, phones and jobs for the local database (never the remote one). Run on a fresh database:
   rm -rf .wrangler/state && npm run db:local && npm run dev -- --port 8787, then python3 test/seed.py"""
import io, json, datetime as dt, requests
from PIL import Image, ImageDraw
from _env import BASE as B, STATE
today = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)).date()
d = lambda n: (today + dt.timedelta(days=n)).isoformat()

PASS = 'cerro-azul-27'          # every made-up person's password, here only
def session(r):
    s = requests.Session()
    s.me = r.json()['user']
    s.headers['Cookie'] = 'mt_sid=' + r.cookies.get('mt_sid')   # the cookie is Secure; requests won't send it over plain http
    s.sid = r.cookies.get('mt_sid')
    return s
def first_admin(name, user, phone):     # an empty database: the first person in is its administrator
    r = requests.post(B + '/api/enter', json={'name': name, 'username': user, 'phone': phone, 'password': PASS}); assert r.ok, r.text
    return session(r)
def person(name, user, phone, role='staff'):  # created by Eric; enters with the temporary password and chooses one
    code = eric.post(B + '/api/users', json={'name': name, 'username': user, 'phone': phone, 'role': role}); assert code.ok, code.text
    code = code.json()['code']
    r = requests.post(B + '/api/enter', json={'username': user, 'password': code}); assert r.ok and r.json().get('need_new'), r.text
    r = requests.post(B + '/api/enter', json={'username': user, 'password': code, 'new_password': PASS}); assert r.ok, r.text
    return session(r)
def post(s, path, data):
    r = s.post(B + '/api' + path, json=data); assert r.ok, (path, r.text); return r.json()
def patch(s, path, data):
    r = s.patch(B + '/api' + path, json=data); assert r.ok, (path, r.text); return r.json()
def photo(s, path, label, color):
    im = Image.new('RGB', (1280, 960), color)
    dr = ImageDraw.Draw(im)
    for i in range(0, 1280, 64): dr.line([(i, 0), (i - 400, 960)], fill=tuple(min(255, c + 18) for c in color), width=18)
    dr.rectangle([380, 300, 900, 700], outline=(250, 250, 245), width=10)
    dr.text((420, 470), label, fill=(255, 255, 255))
    full = io.BytesIO(); im.save(full, 'JPEG', quality=74)
    th = io.BytesIO(); im.resize((320, 240)).save(th, 'JPEG', quality=60)
    r = s.post(B + '/api' + path, files={'photo': ('foto.jpg', full.getvalue(), 'image/jpeg'), 'thumb': ('mini.jpg', th.getvalue(), 'image/jpeg')})
    assert r.ok, r.text

eric = first_admin('Eric Méndez', 'emendez', '+1 512 555 0100')
adrian = person('Adrián Robles', 'arobles', '415 555 0142', 'admin')
jaime = person('Jaime López', 'jlopez', '415 555 0177')
lupita = person('Guadalupe Ramírez', 'gramirez', '415 555 0119')
# someone created who has not come in yet: the e2e test enters with her temporary password, typed by Eric
pend = eric.post(B + '/api/users', json={'name': 'Rosa Méndez', 'username': 'rmendez', 'phone': '415 555 0199', 'temp': '7654321'}).json()
assert pend['code'] == '7654321', pend
A = {a['name']: a['id'] for a in eric.get(B + '/api/bootstrap').json()['areas']}
P = {}
for name, kind, spec, phone, comp in [
    ('Anselmo Rivas', 'externo', 'Refrigeración', '442 555 0188', 'Frío del Bajío'),
    ('Octavio Tovar', 'externo', 'Carpintería', '415 555 0163', None),
    ('Chuy Hernández', 'externo', 'Plomería', '415 555 0125', None),
    ('Marco Antonio Gil', 'externo', 'Herrería', '415 555 0131', None),
    ('Raúl Mendoza', 'externo', 'Electricidad', '415 555 0150', 'Electro Servicio San Miguel'),
]:
    tags = {'Chuy Hernández': ['Plomería', 'Gas'], 'Anselmo Rivas': ['Refrigeración', 'Equipo de bodega']}.get(name, [spec])
    P[name] = post(adrian, '/providers', {'name': name, 'kind': kind, 'specialty': spec, 'phone': phone, 'company': comp, 'tags': tags})['id']
P['Adrián'] = adrian.me['provider_id']; P['Jaime'] = jaime.me['provider_id']
patch(eric, '/settings', {'coordinator': P['Adrián']})

# equipment
E = {}
E['chiller'] = post(adrian, '/equipment', {'name': 'Chiller principal de bodega', 'area_id': A['Bodega y cava'], 'brand_model': 'Hecho a la medida', 'provider_id': P['Anselmo Rivas'], 'location': 'Patio de bodega', 'plan_months': [3, 9], 'last_service': d(-70), 'notes': 'Revisar el presostato en cada servicio.'})['id']
E['refri'] = post(adrian, '/equipment', {'name': 'Refrigerador de cocina (2 puertas)', 'area_id': A['Restaurante'], 'brand_model': 'Torrey R-36', 'serial': 'TR36-2291084', 'provider_id': P['Anselmo Rivas'], 'plan_months': [6, 12], 'last_service': d(-160)})['id']
E['barra'] = post(adrian, '/equipment', {'name': 'Refrigerador de la barra', 'area_id': A['Restaurante'], 'brand_model': 'Imbera VR-17', 'provider_id': P['Anselmo Rivas']})['id']
E['bomba'] = post(adrian, '/equipment', {'name': 'Bomba de la cisterna', 'area_id': A['Instalaciones'], 'brand_model': 'Evans 1 HP', 'provider_id': P['Chuy Hernández'], 'last_service': d(-400)})['id']
E['planta'] = post(adrian, '/equipment', {'name': 'Planta de luz', 'area_id': A['Instalaciones'], 'brand_model': 'Kohler 20 kW', 'provider_id': P['Raúl Mendoza'], 'plan_months': list(range(1, 13))})['id']
photo(adrian, '/equipment/%d/photos' % E['chiller'], 'CHILLER', (70, 86, 96))
photo(adrian, '/equipment/%d/photos' % E['refri'], 'REFRIGERADOR', (150, 150, 146))
photo(adrian, '/equipment/%d/photos' % E['planta'], 'PLANTA DE LUZ', (176, 120, 40))

# preventive plans
post(adrian, '/pm', {'title': 'Fumigación', 'area_id': A['Restaurante'], 'unit': 'months', 'months': [2, 5, 8, 11], 'day': 26, 'provider_id': None, 'lead_days': 7})
post(adrian, '/pm', {'title': 'Revisar extintores', 'area_id': A['Instalaciones'], 'unit': 'months', 'months': [1], 'day': 15, 'provider_id': P['Jaime'], 'lead_days': 14})
post(adrian, '/pm', {'title': 'Limpiar trampas de grasa', 'area_id': A['Restaurante'], 'unit': 'months', 'months': list(range(1, 13)), 'day': 5, 'provider_id': P['Chuy Hernández'], 'lead_days': 3})
post(adrian, '/pm', {'title': 'Podar los árboles del estacionamiento', 'area_id': A['Jardín y huerta'], 'unit': 'once', 'next_due': d(40), 'provider_id': P['Adrián'], 'lead_days': 7})
E['old'] = post(eric, '/equipment', {'name': 'Chiller', 'brand_model': 'Tank Temp', 'location': 'Area de Produccion', 'provider_id': P['Anselmo Rivas']})['id']
post(eric, '/pm', {'title': 'Servicio preventivo: Chiller', 'equipment_id': E['old'], 'provider_id': P['Anselmo Rivas'], 'unit': 'month', 'every_n': 3, 'next_due': d(69), 'lead_days': 7})
# services logged by hand through the year
for eq, title, days, who, cost in [('refri', 'Limpieza de condensador', -160, 'Anselmo Rivas', 1800), ('chiller', 'Cambio de contactor', -31, 'Anselmo Rivas', 4200), ('chiller', 'Recarga de gas', -70, 'Anselmo Rivas', 6500), ('bomba', 'Cambio de sello mecánico', -210, 'Chuy Hernández', 950)]:
    post(adrian, '/tasks', {'kind': 'servicio', 'title': title, 'equipment_id': E[eq], 'provider_id': P[who], 'completed_date': d(days), 'cost': cost})

# pendientes (a report gets no day by itself: the ones that sit on a day here were given one)
def task(s, **k):   # only administrators give a day: a day on someone else's report is Adrián planning it
    due = k.pop('due_date', None) if s not in (eric, adrian) else None
    tid = post(s, '/tasks', k)['task']['id']
    if due: patch(adrian, '/tasks/%d' % tid, {'due_date': due})
    return tid
# Adrián's time this week and next: the garden in the mornings, purchases on Thursday
mon = today - dt.timedelta(days=today.weekday())
for i in range(5):
    post(adrian, '/blocks', {'title': 'Huerto', 'day': str(mon + dt.timedelta(days=i)), 'start_min': 8 * 60, 'end_min': 11 * 60, 'provider_id': P['Adrián']})
post(adrian, '/blocks', {'title': 'Compras', 'day': str(mon + dt.timedelta(days=3)), 'start_min': 15 * 60, 'end_min': 17 * 60, 'provider_id': P['Adrián']})
t1 = task(lupita, title='Gotea la llave del baño de visitas', area_id=A['Restaurante'], priority=1, due_date=d(0), description='Ya hay charco junto al lavabo. Se cerró la llave de paso.')
photo(lupita, '/tasks/%d/photos' % t1, 'LAVABO', (90, 120, 150))
t2 = task(eric, title='Chiller no enfría: se disparó otra vez', equipment_id=E['chiller'], priority=1, provider_id=P['Anselmo Rivas'], due_date=d(-7))
photo(eric, '/tasks/%d/photos' % t2, 'TABLERO', (60, 60, 70))
post(adrian, '/tasks/%d/notes' % t2, {'body': 'Anselmo dice que viene el martes con el presostato nuevo.'})
patch(adrian, '/tasks/%d' % t2, {'status': 'en_espera', 'wait_reason': 'proveedor'})
t3 = task(jaime, title='La puerta de la cava no cierra bien', area_id=A['Bodega y cava'], priority=2, provider_id=P['Octavio Tovar'], due_date=d(-12))
patch(adrian, '/tasks/%d' % t3, {'due_date': d(-4), 'postpone_reason': 'Espero al externo'})
patch(adrian, '/tasks/%d' % t3, {'due_date': d(-1), 'postpone_reason': 'Falta material'})
t4 = task(lupita, title='Foco fundido en la terraza del restaurante', area_id=A['Restaurante'], priority=3)
t5 = task(eric, title='Pintar el barandal de la capilla antes de la boda del 12 de diciembre', area_id=A['Capilla / Contemplo'], priority=3, due_date=d(14), provider_id=P['Marco Antonio Gil'])
t6 = task(adrian, title='Cambiar manguera de riego rota en la huerta', area_id=A['Jardín y huerta'], priority=3, provider_id=P['Adrián'], due_date=d(0))
patch(adrian, '/tasks/%d' % t6, {'status': 'en_proceso'})
t7 = task(jaime, title='Tapa del registro suelta en el estacionamiento', area_id=A['Instalaciones'], priority=2, due_date=d(1))
t8 = task(lupita, title='Aire acondicionado de la oficina hace ruido', area_id=A['Oficina'], priority=4)
t9 = task(eric, title='Regadera de la cabaña 2 sin agua caliente', area_id=A['Hospedaje'], priority=2, provider_id=P['Chuy Hernández'], due_date=d(2))
photo(eric, '/tasks/%d/photos' % t9, 'REGADERA', (120, 96, 84))
t10 = task(jaime, title='Luminaria del viñedo apagada (poste 4)', area_id=A['Viñedo'], priority=3, provider_id=P['Jaime'], due_date=d(5))
# the planner: some of it already has an hour
patch(adrian, '/tasks/%d' % t6, {'plan_min': 9 * 60, 'est_min': 90})
patch(adrian, '/tasks/%d' % t9, {'plan_min': 11 * 60, 'est_min': 60})
t11 = task(adrian, title='Revisar la presión de la bomba de la cisterna', equipment_id=E['bomba'], priority=3, provider_id=P['Adrián'], due_date=d(0))
patch(adrian, '/tasks/%d' % t11, {'plan_min': 12 * 60 + 30, 'est_min': 30})
t12 = task(adrian, title='Recibir al herrero para la reja del estacionamiento', area_id=A['Instalaciones'], priority=3, provider_id=P['Marco Antonio Gil'], due_date=d(1))
patch(adrian, '/tasks/%d' % t12, {'plan_min': 10 * 60, 'est_min': 120})
# done ones
for title, area, who, note, cost in [('Destapar coladera de la cocina', 'Restaurante', 'Chuy Hernández', 'Se destapó y se limpió la trampa.', 600), ('Arreglar chapa del almacén', 'Bodega y cava', 'Adrián', 'Se cambió la chapa.', 350), ('Reponer vidrio roto del salón', 'Eventos', 'Octavio Tovar', None, 1200)]:
    tid = task(lupita, title=title, area_id=A[area], priority=3, provider_id=P[who])
    patch(adrian, '/tasks/%d' % tid, {'status': 'hecha', 'note': note, 'cost': cost})
print('seeded', {'tasks': t12, 'equipment': E})
json.dump({'pass': PASS, 'rosa_code': pend['code'], 'rosa_id': pend['id'], 'sids': [eric.sid, adrian.sid, jaime.sid, lupita.sid],
           'urgent': t1, 'photo': t2, 'late': t3, 'plain': t4, 'far': t5, 'mine': t6, 'eq': E['chiller'], 'eq2': E['refri'], 'ext': P['Chuy Hernández'], 'plan': 1}, open(STATE, 'w'))
