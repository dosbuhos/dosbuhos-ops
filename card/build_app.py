import json, os, shutil, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(ROOT, "public")
os.makedirs(os.path.join(PUB, "icons"), exist_ok=True)
os.makedirs(os.path.join(PUB, "vcf"), exist_ok=True)

# ---------------- CONFIG (edit here) ----------------
BASE = "https://hola.dosbuhos.com"
WA_MAIN = "524151247583"            # TODO verify — winery line from public listing
LINKS = {
    "OPENTABLE": "https://www.opentable.com/s?term=Dos%20B%C3%BAhos",  # TODO replace with the restaurant's direct OpenTable link (+ your source tag)
    "TOURS": "https://dosbuhos.com",      # TODO tours/tastings page
    "EVENTS": "https://dosbuhos.com",     # TODO events page
    "SHOP": "https://dosbuhos.com",       # TODO online store
    "CLUB": "https://dosbuhos.com",       # TODO wine club page
    "NOTES": "https://dosbuhos.com",      # TODO tasting-notes doc/PDF
    "PRESSKIT": "/press/",
    "INSTAGRAM": "https://www.instagram.com/vinedodosbuhos",
    "MAPS": "https://maps.google.com/?q=Bodega+Dos+Buhos+San+Miguel+de+Allende",
    "WA_VISITS": WA_MAIN, "WA_EVENTS": "524151390978", "WA_SALES": WA_MAIN,
    "HOURS": "Wed–Sun 12:00–18:00 · TODO confirm",
}
PEOPLE = {
    "dosbuhos": {"name": "Dos Búhos", "role": None, "first": "", "last": "", "title": "", "email": "reservaciones@dosbuhos.com", "whatsapp": WA_MAIN},
    "eric":     {"name": "Eric Maycotte",     "role": {"en": "Owner · Winemaking team", "es": "Propietario · Equipo de vinificación"}, "first": "Eric", "last": "Maycotte", "title": "Owner", "email": "eric@dosbuhos.com", "whatsapp": WA_MAIN},
    "diane":    {"name": "Diane Maycotte",    "role": {"en": "Winemaker", "es": "Enóloga"}, "first": "Diane", "last": "Maycotte", "title": "Winemaker", "email": "enologia@dosbuhos.com", "whatsapp": WA_MAIN},
    "higinio":  {"name": "Higinio Maycotte",  "role": {"en": "Grape grower · Founder", "es": "Viticultor · Fundador"}, "first": "Higinio", "last": "Maycotte", "title": "Grape grower", "email": "info@dosbuhos.com", "whatsapp": WA_MAIN},
    "melanie":  {"name": "Melanie Harris",    "role": {"en": "Head of Events & Community", "es": "Directora de Eventos y Comunidad"}, "first": "Melanie", "last": "Harris", "title": "Head of Events & Community", "email": "eventos@dosbuhos.com", "whatsapp": WA_MAIN},
    "michael":  {"name": "Michael Dunlop",    "role": {"en": "Food & Beverage Director", "es": "Director de Alimentos y Bebidas"}, "first": "Michael", "last": "Dunlop", "title": "Food & Beverage Director", "email": "reservaciones@dosbuhos.com", "whatsapp": WA_MAIN},
}

WINES_APP = [
  {"kind_en":"Red · the flagship","kind_es":"Tinto · vino insignia","name":"Aglianico Gran Reserva","grape":"100% Aglianico","en":"Black fruit, cardamom, clove and the volcanic ground it came from. Two barrels a vintage, two years in barrel.","es":"Fruta negra, cardamomo, clavo y la tierra volcánica de donde viene. Dos barricas por cosecha, dos años en barrica.","pair_en":"Lamb, smoked ribs, aged cheese","pair_es":"Cordero, costillas ahumadas, queso añejo","medal":"Wine club allocation"},
  {"kind_en":"White","kind_es":"Blanco","name":"Chenin Blanc","grape":"100% Chenin Blanc · stainless, 6 months on lees","en":"Asian pear, yellow apple, white flowers, a whisper of honey. Bright acid, limestone, a textured finish.","es":"Pera asiática, manzana amarilla, flores blancas, un toque de miel. Acidez vibrante, caliza, final con textura.","pair_en":"Oysters, salads, roasted Camembert","pair_es":"Ostiones, ensaladas, Camembert horneado","medal":"90 pts · Catadores del Vino Mexicano"},
  {"kind_en":"Orange wine","kind_es":"Vino naranja","name":"Espontáneo","grape":"Moscato Giallo on skins","en":"Candied orange, kumquat, lychee over fine honey. Dry, long, a saline edge.","es":"Naranja cristalizada, kumquat, lichi sobre notas de miel. Seco, largo, un toque salino.","pair_en":"Sushi, tempura, curry, duck à l'orange","pair_es":"Sushi, tempura, curry, pato a la naranja","medal":"Gold · Bacchus 2026"},
  {"kind_en":"Red · Gran Reserva","kind_es":"Tinto · Gran Reserva","name":"Tempranillo Gran Reserva","grape":"100% Tempranillo","en":"Our most decorated red. Long barrel age, built for the table and the cellar.","es":"Nuestro tinto más premiado. Larga crianza, para la mesa y la cava.","pair_en":"Rib eye, mole, braises","pair_es":"Rib eye, mole, guisos largos","medal":"Gold · Bacchus 2026"},
  {"kind_en":"Red","kind_es":"Tinto","name":"Grenache","grape":"100% Grenache","en":"Red fruit and warm spice from the high desert; the wine that put the altiplano on the Brussels podium.","es":"Fruta roja y especia cálida del altiplano; el vino que subió al podio en Bruselas.","pair_en":"Roast chicken, grilled vegetables","pair_es":"Pollo rostizado, verduras a la brasa","medal":"Grand Gold · Concours Mondial de Bruxelles 2024"},
  {"kind_en":"Sparkling · ancestral method","kind_es":"Espumoso · método ancestral","name":"Pet Nat","grape":"Moscato Giallo","en":"Bottle-fermented, cloudy, alive. The wine we open first.","es":"Fermentado en botella, turbio, vivo. El vino que abrimos primero.","pair_en":"Aperitivo, tacos, anything fried","pair_es":"Aperitivo, tacos, lo frito","medal":"Gold · LA International 2025"},
  {"kind_en":"Sparkling · traditional method","kind_es":"Espumoso · método tradicional","name":"1524 Espumoso Rosé Brut","grape":"45% Tempranillo · 45% Syrah · 10% Cabernet Franc · 9 months on lees","en":"Ripe peach, dried strawberry, apricot, a sea-spray lift. Fine persistent bubbles, bright dry finish.","es":"Durazno maduro, fresa deshidratada, chabacano, un toque salino. Burbuja fina y persistente, final seco.","pair_en":"Soft cheese, Serrano ham, celebrations","pair_es":"Quesos suaves, jamón serrano, celebraciones","medal":""},
  {"kind_en":"White","kind_es":"Blanco","name":"Sauvignon Blanc","grape":"100% Sauvignon Blanc","en":"Cold nights in a glass: crisp, herbal, citrus-driven.","es":"Las noches frías en una copa: fresco, herbal, cítrico.","pair_en":"Ceviche, goat cheese, green salads","pair_es":"Ceviche, queso de cabra, ensaladas verdes","medal":""},
  {"kind_en":"White blend","kind_es":"Blanco de mezcla","name":"Mosaico Blanco","grape":"Sauvignon Blanc · Sémillon · Moscato","en":"Three whites, one glass: aromatic, round, easy to pour all afternoon.","es":"Tres blancos, una copa: aromático, redondo, para toda la tarde.","pair_en":"Seafood, Sunday lunch","pair_es":"Mariscos, comida de domingo","medal":""},
  {"kind_en":"Red blends","kind_es":"Tintos de mezcla","name":"Efímero","grape":"Small-lot blends, a mother-and-son project","en":"Each release a different conversation between the cellar's barrels. When it's gone, it's gone.","es":"Cada edición, una conversación distinta entre las barricas. Cuando se acaba, se acaba.","pair_en":"","pair_es":"","medal":"Limited release"},
  {"kind_en":"Aperitivo & dessert","kind_es":"Aperitivo y postre","name":"Vermouth · Vin d'Orange · Vino Dulce","grape":"Estate wine bases, estate botanicals","en":"Red vermouth on a Tempranillo–Syrah base, our Vin d'Orange Amère, and a sweet wine for the end of the night.","es":"Vermut rojo con base Tempranillo–Syrah, nuestro Vin d'Orange Amère y un vino dulce para cerrar la noche.","pair_en":"Over ice, with tonic, or neat","pair_es":"En las rocas, con tónica o solo","medal":""},
]

# Awards — from Dos_Búhos_Premios.xlsx + Puntos 2027 (newest first). medal keys: gg=Grand Gold, g=Gold, s=Silver, b=Bronze, m=CMB Merit, p=points
AWARDS = [
  {"comp":"Concours Mondial de Bruxelles","year":2026,"icon":"cmb","items":[["Grenache 2021","s"],["Aglianico 2022","m"],["Anaranjado 2023","m"],["Sauvignon Blanc 2024","m"],["1524 Moscato Giallo 2025","m"]]},
  {"comp":"Bacchus · Unión Española de Catadores","year":2026,"icon":"bacchus","items":[["Tempranillo 2022","g"],["Anaranjado 2023","g"]]},
  {"comp":"Los Angeles International Wine Competition","year":2026,"icon":"la","items":[["Chenin Blanc 2024","s"],["Aglianico 2021","s"],["Tempranillo 2022","b"]]},
  {"comp":"Puntos 2027","year":2027,"icon":"","items":[["Aglianico 2020","97 pts"],["Tempranillo 2022","93 pts"],["Cabernet Franc Gran Reserva 2022","93 pts"],["1524 Mosaico 2023","92 pts"],["Chenin Blanc 2024","89 pts"],["Grenache Gran Reserva 2021","88 pts"]]},
  {"comp":"Concours Mondial de Bruxelles","year":2025,"icon":"cmb","items":[["Tempranillo 2020","s"],["Sauvignon Blanc 2024","s"]]},
  {"comp":"Los Angeles International Wine Competition","year":2025,"icon":"la","items":[["Moscato Giallo Pet Nat 2022","g"],["Espumoso Rosado 2020","s"],["Aglianico 2020","s"]]},
  {"comp":"Concours Mondial de Bruxelles","year":2024,"icon":"cmb","items":[["Grenache 2019","gg"],["Anaranjado 2021","s"],["1524 Espumoso Blanco 2022","s"],["Grenache 2020","s"]]},
  {"comp":"Los Angeles International Wine Competition","year":2024,"icon":"la","items":[["Chenin Blanc 2022","b"]]},
  {"comp":"Catadores del Vino Mexicano","year":0,"icon":"","items":[["1524 Espumoso Rosé 2022","95 pts"],["Tempranillo 2020","95 pts"],["1524 Espumoso Blanco 2022","93 pts"],["Cabernet Sauvignon 2020","93 pts"],["Selección Especial 2017","92 pts"],["Chardonnay 2021","92 pts"],["Sauvignon Blanc 2020","91 pts"],["Tempranillo 2016","91 pts"],["Aglianico 2015","91 pts"],["Moscato Giallo Pet Nat 2021","91 pts"],["Espumoso Rosado 2020","91 pts"],["Chenin Blanc 2022","90 pts"],["Grenache 2020","90 pts"]]},
  {"comp":"Concours Mondial de Bruxelles · México","year":2023,"icon":"cmb","items":[["Moscato Giallo Pet Nat 2021","s"]]},
  {"comp":"Concours Mondial de Bruxelles · México","year":2022,"icon":"cmb","items":[["Sauvignon Blanc 2021","s"]]},
  {"comp":"Concours Mondial de Bruxelles · México","year":2021,"icon":"cmb","items":[["Cabernet Sauvignon 2017","s"]]},
]

PHOTOS = [
    {"f": "photos/harvest.jpg", "en": "Harvest at dawn", "es": "Vendimia al amanecer"},
    {"f": "photos/planting.jpg", "en": "Planting the first vines, 2006", "es": "Plantando las primeras vides, 2006"},
    {"f": "photos/family-road.jpg", "en": "Four generations on this road", "es": "Cuatro generaciones en este camino"},
    {"f": "photos/cellar.jpg", "en": "Amphora, native-yeast ferments, barrels, sheep", "es": "Ánforas, fermentaciones con levadura nativa, barricas, borregos"},
    {"f": "photos/harvest-bin.jpg", "en": "Chenin Blanc into the bin", "es": "Chenin Blanc a la tina"},
    {"f": "photos/glasses.jpg", "en": "Espontáneo, our orange wine", "es": "Espontáneo, nuestro vino naranja"},
    {"f": "photos/tasting.jpg", "en": "The tasting room", "es": "La sala de cata"},
    {"f": "photos/grandfather.jpg", "en": "The land before the vines", "es": "La tierra antes de las vides"},
    {"f": "photos/community.jpg", "en": "Feed The Hungry at the winery", "es": "Feed The Hungry en la bodega"},
    {"f": "photos/vineyard-talk.jpg", "en": "In the vineyard", "es": "En el viñedo"},
    {"f": "photos/winegarden-night.jpg", "en": "The Winegarden at night", "es": "El Winegarden de noche"},
    {"f": "photos/bodega-arte.jpg", "en": "Bodega de Arte, set for dinner", "es": "La Bodega de Arte, lista para cenar"},
    {"f": "photos/lunch-table.jpg", "en": "Lunch under the trees", "es": "Comida bajo los árboles"},
    {"f": "photos/wedding-toast.jpg", "en": "A toast in the Bodega de Arte", "es": "Un brindis en la Bodega de Arte"},
    {"f": "photos/hacienda.jpg", "en": "The whole estate, yours for a day", "es": "La hacienda completa, por un día"},
    {"f": "photos/recorrido.jpg", "en": "The vineyard walk", "es": "El recorrido"},
    {"f": "photos/pouring.jpg", "en": "Espontáneo, poured", "es": "Espontáneo, al servir"},
    {"f": "photos/petanque.jpg", "en": "Pétanque in the garden", "es": "Petanca en el jardín"},
]
# ----------------------------------------------------

sizes = {}
for p in PHOTOS:
    im = Image.open(os.path.join(PUB, p["f"])); p["w"], p["h"] = im.size

for f in ["cmb.png","bacchus.png","la.png"]: shutil.copy(os.path.join(os.path.join(ROOT, "assets"), f), os.path.join(PUB, "icons", f))
# icons: logo (white script), monograms
shutil.copy(os.path.join(ROOT, "assets", "script_logo.png"), os.path.join(PUB, "icons", "logo.png"))
mono = Image.open(os.path.join(ROOT, "assets", "monogram.png")).convert("RGBA"); a = mono.split()[3]
dark = Image.new("RGBA", mono.size, (10, 10, 10, 255)); dark.putalpha(a); dark.thumbnail((200, 260)); dark.save(os.path.join(PUB, "icons", "mono-dark.png"))
light = Image.new("RGBA", mono.size, (245, 240, 232, 255)); light.putalpha(a); light.thumbnail((200, 260)); light.save(os.path.join(PUB, "icons", "mono-light.png"))

qr = json.load(open(os.path.join(ROOT, "qr.json")))
tpl = open(os.path.join(ROOT, "app_template.html"), encoding="utf-8").read()
html = tpl
for k, v in LINKS.items():
    html = html.replace("__" + k + "__", v)
html = html.replace("__AWARDS_JS__", json.dumps(AWARDS, ensure_ascii=False)).replace("__WINES_JS__", json.dumps(WINES_APP, ensure_ascii=False)).replace("__PEOPLE__", json.dumps(PEOPLE, ensure_ascii=False)).replace("__QR__", json.dumps(qr)).replace("__PHOTOS__", json.dumps(PHOTOS, ensure_ascii=False))
open(os.path.join(PUB, "index.html"), "w", encoding="utf-8").write(html)

# manifests
for k, p in PEOPLE.items():
    m = {"name": (p["name"] + " · Dos Búhos") if k != "dosbuhos" else "Dos Búhos", "short_name": "Dos Búhos" if k == "dosbuhos" else p["first"],
         "start_url": "/" + ("" if k == "dosbuhos" else k), "scope": "/", "display": "standalone", "background_color": "#0a0a0a", "theme_color": "#0a0a0a",
         "icons": [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png"}]}
    json.dump(m, open(os.path.join(PUB, f"manifest-{k}.webmanifest"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# vcards
for k, p in PEOPLE.items():
    if k == "dosbuhos":
        v = f"""BEGIN:VCARD\nVERSION:3.0\nN:;;;;\nFN:Bodega Dos Búhos\nORG:Bodega Dos Búhos\nEMAIL;TYPE=INTERNET:{p['email']}\nTEL;TYPE=WORK:+{p['whatsapp']}\nURL:https://dosbuhos.com\nADR;TYPE=WORK:;;Km 6 Carretera San Miguel de Allende–Querétaro;San Miguel de Allende;Guanajuato;;México\nNOTE:Certified organic wine at 6,500 ft, San Miguel de Allende, Mexico.\nEND:VCARD\n"""
    else:
        v = f"""BEGIN:VCARD\nVERSION:3.0\nN:{p['last']};{p['first']};;;\nFN:{p['name']}\nORG:Bodega Dos Búhos\nTITLE:{p['title']}\nEMAIL;TYPE=INTERNET:{p['email']}\nTEL;TYPE=WORK:+{p['whatsapp']}\nURL:{BASE}/{k}\nADR;TYPE=WORK:;;Km 6 Carretera San Miguel de Allende–Querétaro;San Miguel de Allende;Guanajuato;;México\nNOTE:Certified organic wine at 6,500 ft, San Miguel de Allende, Mexico.\nEND:VCARD\n"""
    open(os.path.join(PUB, "vcf", f"{k}.vcf"), "w", encoding="utf-8").write(v)


PRESS_EMAIL = "eric@dosbuhos.com"          # TODO
MARKETING_EMAIL = "marketing@dosbuhos.com" # TODO Diana's
WINES = [
  {"name": "Aglianico Gran Reserva", "meta": "100% Aglianico · vintage ____ · two years in barrel",
   "en": "Black fruit, cardamom, clove, volcanic minerality; high natural acidity, long finish.", "es": "Fruta negra, cardamomo, clavo, mineralidad volcánica; acidez natural alta, final largo.",
   "pair_en": "Lamb, smoked ribs, aged cheeses · ~50 cases (two barrels)", "pair_es": "Cordero, costillas ahumadas, quesos añejos · ~50 cajas (dos barricas)", "todo": "Diane to confirm notes and élevage"},
  {"name": "Tempranillo Gran Reserva", "meta": "100% Tempranillo · vintage ____ · Gold, Bacchus 2026", "en": "", "es": "", "pair_en": "", "pair_es": "", "todo": "notes pending"},
  {"name": "Chenin Blanc", "meta": "100% Chenin Blanc · vintage ____ · stainless steel, 6 months on lees · 12.5%",
   "en": "Asian pear, yellow apple, white flowers, a whisper of honey. Bright acidity, limestone and herbal notes, textured finish.", "es": "Pera asiática, manzana amarilla, flores blancas, un toque de miel. Acidez vibrante, notas de caliza y hierbas, final con textura.",
   "pair_en": "Oysters, spring salads, roasted Camembert · ~170 cases", "pair_es": "Ostiones, ensaladas de primavera, Camembert horneado · ~170 cajas", "todo": ""},
  {"name": "Sauvignon Blanc", "meta": "100% Sauvignon Blanc · vintage ____", "en": "", "es": "", "pair_en": "", "pair_es": "", "todo": "notes pending"},
  {"name": "Grenache", "meta": "100% Grenache · vintage ____ · Grand Gold, Concours Mondial de Bruxelles 2024", "en": "", "es": "", "pair_en": "", "pair_es": "", "todo": "notes pending"},
  {"name": "Espontáneo · orange wine", "meta": "Moscato Giallo on skins · vintage ____ · Gold, Bacchus 2026",
   "en": "Deep orange with amber and copper glints. Candied orange, kumquat, citrus and lychee over fine honey notes. Dry and balanced, long fresh finish, a saline edge.", "es": "Naranja intenso con destellos ámbar y cobrizos. Naranja cristalizada, kumquat, cítricos y lichi sobre finas notas de miel. Seco y equilibrado, final largo y fresco, un toque salino.",
   "pair_en": "Sushi, sashimi, tempura, citrus salads, aged cheeses, curry, paella, duck à l'orange", "pair_es": "Sushi, sashimi, tempura, ensaladas cítricas, quesos maduros, curry, paella, pato a la naranja", "todo": ""},
  {"name": "Pet Nat", "meta": "Moscato Giallo · vintage ____ · ancestral method · Gold, LA International 2025", "en": "", "es": "", "pair_en": "", "pair_es": "", "todo": "notes pending"},
  {"name": "1524 Espumoso Rosé Brut", "meta": "45% Tempranillo, 45% Syrah, 10% Cabernet Franc · vintage ____ · traditional method, 9 months on lees · 12.5%",
   "en": "Ripe peach, dried strawberry and apricot with a saline sea-spray lift. Fine, persistent bubbles, a hint of agave honey, bright dry finish.", "es": "Durazno maduro, fresa deshidratada y chabacano con un toque salino. Burbuja fina y persistente, un dejo de miel de agave, final seco y vibrante.",
   "pair_en": "Soft cheeses, Serrano ham, charcuterie, berry-and-goat-cheese salads", "pair_es": "Quesos suaves, jamón serrano, charcutería, ensaladas de frutos rojos y queso de cabra", "todo": ""},
  {"name": "Mosaico Blanco", "meta": "Sauvignon Blanc 62%, Sémillon 24%, Moscato 14% · vintage ____", "en": "", "es": "", "pair_en": "", "pair_es": "", "todo": "notes pending"},
  {"name": "Efímero", "meta": "The blended collection — a mother-and-son project · blends per release", "en": "", "es": "", "pair_en": "", "pair_es": "", "todo": "current blends and notes pending"},
  {"name": "Vermouth · Vin d'Orange Amère · Vino Dulce", "meta": "Vermouth on a Tempranillo–Syrah base", "en": "", "es": "", "pair_en": "", "pair_es": "", "todo": "notes pending"},
]
def wine_html(w):
    h = f'<div class="wine"><h3>{w["name"]}</h3><div class="meta">{w["meta"]}</div>'
    if w["en"]: h += f'<p><span class="en">{w["en"]}</span><span class="es">{w["es"]}</span></p>'
    if w["pair_en"]: h += f'<p class="pair"><span class="en">{w["pair_en"]}</span><span class="es">{w["pair_es"]}</span></p>'
    if w["todo"]: h += f'<p class="todo">[{w["todo"]}]</p>'
    return h + '</div>'
press = open(os.path.join(ROOT, "press_template.html"), encoding="utf-8").read()
MED = {"gg":("Grand Gold","Gran Oro"),"g":("Gold","Oro"),"s":("Silver","Plata"),"b":("Bronze","Bronce"),"m":("CMB Merit","CMB Merit")}
rows = []
for a in AWARDS:
    for wine, med in a["items"]:
        en, es = MED.get(med, (med, med))
        rows.append(f'<tr><td>{wine}</td><td><span class="en">{en}</span><span class="es">{es}</span></td><td>{a["comp"]}{(" " + str(a["year"])) if a["year"] and a["comp"] != "Puntos 2027" else ""}</td></tr>')
press = press.replace("__AWARDS_TABLE__", "<table><tr><th class=\"en\">Wine</th><th class=\"es\">Vino</th><th class=\"en\">Award</th><th class=\"es\">Premio</th><th class=\"en\">Competition</th><th class=\"es\">Concurso</th></tr>" + "\n".join(rows) + "</table>")
press = press.replace("__WINES__", "\n".join(wine_html(w) for w in WINES)).replace("__PHOTOS__", json.dumps(PHOTOS, ensure_ascii=False))
press = press.replace("__OPENTABLE__", LINKS["OPENTABLE"]).replace("__MAPS__", LINKS["MAPS"]).replace("__WA_MAIN__", WA_MAIN).replace("__PRESS_EMAIL__", PRESS_EMAIL).replace("__MARKETING_EMAIL__", MARKETING_EMAIL)
os.makedirs(os.path.join(PUB, "press"), exist_ok=True)
open(os.path.join(PUB, "press", "index.html"), "w", encoding="utf-8").write(press)

# service worker
precache = ["/", "/index.html", "/press/", "/press/index.html", "/icons/logo.png", "/icons/mono-dark.png", "/icons/mono-light.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"] + [f"/fonts/{f}" for f in os.listdir(os.path.join(PUB, "fonts"))] + \
           [f"/manifest-{k}.webmanifest" for k in PEOPLE] + [f"/vcf/{k}.vcf" for k in PEOPLE] + ["/" + p["f"] for p in PHOTOS]
sw = """// Dos Búhos card — offline first, refresh in background
const VERSION = 'v__VER__';
const PRECACHE = __PRECACHE__;
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // fonts etc.: network, browser cache
  const isNav = e.request.mode === 'navigate';
  const key = isNav ? (url.pathname.startsWith('/press') ? '/press/index.html' : '/index.html') : e.request;
  e.respondWith(caches.open(VERSION).then(async c => {
    const cached = await c.match(key);
    const net = fetch(e.request).then(r => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    return cached || (await net) || (isNav ? c.match(key) : Response.error());
  }));
});
"""
import time
sw = sw.replace("__VER__", time.strftime("%Y%m%d%H%M")).replace("__PRECACHE__", json.dumps(precache))
open(os.path.join(PUB, "sw.js"), "w").write(sw)

open(os.path.join(PUB, "_headers"), "w").write("""/vcf/*
  Content-Type: text/vcard; charset=utf-8
  Content-Disposition: attachment
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/*.webmanifest
  Content-Type: application/manifest+json
""")

print("built", len(html), "bytes;", len(precache), "precached")
