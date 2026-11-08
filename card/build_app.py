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
    "OPENTABLE": "https://www.opentable.com.mx/restref/client/?restref=1258120&lang=es-MX&ot_source=Restaurant%20website",  # restaurant-referral link (rid 1258120): bookings credit the restaurant's own channel
    "TOURS": "https://www.opentable.com.mx/restref/client/?restref=1258120&lang=es-MX&ot_source=Restaurant%20website",  # tours are booked on OpenTable too
    "EVENTS": "https://dosbuhos.com",     # TODO events page
    "SHOP": "https://dosbuhos.com/shop/",
    "CLUB": "https://dosbuhos.com/wine-club/",
    "NOTES": "https://dosbuhos.com",      # TODO tasting-notes doc/PDF
    "PRESSKIT": "/press/",
    "INSTAGRAM": "https://www.instagram.com/vinedodosbuhos",
    "MAPS": "https://maps.google.com/?q=Bodega+Dos+Buhos+San+Miguel+de+Allende",
    "WA_VISITS": WA_MAIN, "WA_EVENTS": "524151390978", "WA_SALES": WA_MAIN,
    "HOURS": "Wed–Thu 11–17 · Fri–Sun 11–18",
}
PEOPLE = {
    "dosbuhos": {"name": "Dos Búhos", "role": None, "first": "", "last": "", "title": "", "email": "reservaciones@dosbuhos.com", "whatsapp": WA_MAIN},
    "eric":     {"name": "Eric Maycotte",     "role": {"en": "Owner · Winemaking team", "es": "Propietario · Equipo de vinificación"}, "first": "Eric", "last": "Maycotte", "title": "Owner", "email": "cabosari@dosbuhos.com", "whatsapp": "15127042059"},
    "diane":    {"name": "Diane Maycotte",    "role": {"en": "Winemaker", "es": "Enóloga"}, "first": "Diane", "last": "Maycotte", "title": "Winemaker", "email": "dmaycotte@gmail.com", "whatsapp": "15129159410"},
    "higinio":  {"name": "Higinio Maycotte",  "role": {"en": "Grape grower · Founder", "es": "Viticultor · Fundador"}, "first": "Higinio", "last": "Maycotte", "title": "Grape grower", "email": "info@dosbuhos.com", "whatsapp": WA_MAIN},
    "melanie":  {"name": "Melanie Harris",    "role": {"en": "Head of Events & Community", "es": "Directora de Eventos y Comunidad"}, "first": "Melanie", "last": "Harris", "title": "Head of Events & Community", "email": "melanie@dosbuhos.com", "whatsapp": "15127678084"},
    "michael":  {"name": "Michael Dunlop",    "role": {"en": "Food & Beverage Director", "es": "Director de Alimentos y Bebidas"}, "first": "Michael", "last": "Dunlop", "title": "Food & Beverage Director", "email": "reservaciones@dosbuhos.com", "whatsapp": WA_MAIN},
}

WINES_APP = [
    # slug, name, kind (en, es), grape line, note (en, es), price MXN, store page, label file, awards [(label, icon)]
    {"slug":"espumoso-rose","name":"1524 Espumoso Rosé Brut","kind_en":"Sparkling · traditional method","kind_es":"Espumoso · método tradicional","grape":"Syrah · Tempranillo · Cabernet Franc · 9 months on the lees",
     "en":"Nine months on the lees and a thread of salt. Peach, dried strawberry, and the kind of bubbles that make a Tuesday feel like it earned something.",
     "es":"Nueve meses sobre lías y un hilo de sal. Durazno, fresa seca y el tipo de burbuja que hace que un martes se sienta merecido.",
     "price":565,"url":"https://dosbuhos.com/product/espumoso-rose/","label":"espumoso-rose","awards":[["95 pts · Catadores del Vino Mexicano","pts"],["Silver · Los Angeles 2025","la"]]},
    {"slug":"petnat","name":"Espontáneo Pet Nat","kind_en":"Sparkling · ancestral method","kind_es":"Espumoso · método ancestral","grape":"Moscato Giallo · bottled mid-ferment",
     "en":"Bottled before it finished fermenting, so it finishes in your glass. Lychee, white peach, honeyed lemon. Open it cold, and over the sink the first time.",
     "es":"Embotellado antes de terminar de fermentar, así que termina en tu copa. Lichi, durazno blanco, limón con miel. Ábrelo frío, y la primera vez sobre el fregadero.",
     "price":728,"url":"https://dosbuhos.com/product/moscato-giallo-pet-nat/","label":"petnat","awards":[["Gold · Los Angeles 2025","la"],["91 pts · Catadores","pts"]]},
    {"slug":"chenin","name":"Chenin Blanc","kind_en":"White","kind_es":"Blanco","grape":"100% Chenin Blanc · stainless, 6 months on lees",
     "en":"Asian pear and white flowers, and under it all the limestone, which is what the altiplano gives you if you let it. Six months on the lees; no oak to get in the way.",
     "es":"Pera asiática y flores blancas, y debajo de todo la caliza, que es lo que da el altiplano si lo dejas. Seis meses sobre lías; sin barrica que estorbe.",
     "price":623,"url":"https://dosbuhos.com/product/chenin-blanc-2/","label":"chenin","awards":[["Silver · Los Angeles 2026","la"],["90 pts · Catadores","pts"]]},
    {"slug":"sauvignon","name":"Sauvignon Blanc","kind_en":"White","kind_es":"Blanco","grape":"100% Sauvignon Blanc",
     "en":"Eureka lemon and magnolia up front, something like caramelised citrus at the end. Cold nights keep it nervy. Aguachile is the obvious call; anything with too much lime is the second.",
     "es":"Limón Eureka y magnolia al frente, algo como cítrico caramelizado al final. Las noches frías lo mantienen nervioso. Aguachile es lo obvio; cualquier cosa con demasiado limón, lo segundo.",
     "price":623,"url":"https://dosbuhos.com/product/sauvignon-blanc/","label":"sauvignon","awards":[["Silver · Brussels 2025","cmb"],["91 pts · Catadores","pts"]]},
    {"slug":"semillon-sb","name":"Sauvignon Blanc – Semillón","kind_en":"White blend","kind_es":"Blanco de mezcla","grape":"Sauvignon Blanc · Semillón",
     "en":"Green apple and peach, a whisper of white flowers; light on its feet. The white for a long lunch, the one you open without quite deciding to.",
     "es":"Manzana verde y durazno, un susurro de flores blancas; ligero de pies. El blanco para una comida larga, el que abres sin haberlo decidido del todo.",
     "price":517,"url":"https://dosbuhos.com/product/semillon-2/","label":"semillon-sb","awards":[]},
    {"slug":"mosaico-blanco","name":"1524 Mosaico Blanco","kind_en":"White blend","kind_es":"Blanco de mezcla","grape":"Sauvignon Blanc · Semillón · Moscato Giallo",
     "en":"Three grapes in one bottle: pineapple and passion fruit from the Moscato, backbone from the Semillón, snap from the Sauvignon. Chill it hard and don't overthink it.",
     "es":"Tres uvas en una botella: piña y maracuyá del Moscato, columna del Semillón, chispa del Sauvignon. Enfríalo bien y no le des tantas vueltas.",
     "price":527,"url":"https://dosbuhos.com/product/mosaico-blanco1524/","label":"mosaico-blanco","awards":[]},
    {"slug":"rose-1524","name":"1524 Rosé","kind_en":"Rosé","kind_es":"Rosado","grape":"Syrah · Tempranillo · Cabernet Franc",
     "en":"Pale, dry, native yeast, unfiltered. Cherry and raspberry, a rosé that works at the table and not only by the pool.",
     "es":"Pálido, seco, levadura nativa, sin filtrar. Cereza y frambuesa; un rosado que funciona en la mesa y no solo junto a la alberca.",
     "price":527,"url":"https://dosbuhos.com/product/rose1524/","label":"rose-1524","awards":[]},
    {"slug":"anaranjado","name":"Espontáneo · Vino Anaranjado","kind_en":"Orange wine · skin contact","kind_es":"Vino naranja · con pieles","grape":"Semillón on its skins · native yeast",
     "en":"A white made like a red: weeks on the skins, then left alone. Dried apricot, walnut, tea-leaf tannin, a little grip. Our strangest wine and, some years, our best.",
     "es":"Un blanco hecho como tinto: semanas con las pieles y luego en paz. Chabacano seco, nuez, tanino de hoja de té, algo de agarre. Nuestro vino más raro y, algunos años, el mejor.",
     "price":1045,"url":"https://dosbuhos.com/product/anaranjado/","label":"anaranjado","awards":[["Gold · Bacchus 2026","bacchus"],["Silver · Brussels 2024","cmb"]]},
    {"slug":"mosaico-tinto","name":"1524 Mosaico Tinto","kind_en":"Red blend","kind_es":"Tinto de mezcla","grape":"Tempranillo · Syrah",
     "en":"The house red, the one that empties first at a long table. Red fruit, soft tannin, no oak sermon. Serve it a touch cool.",
     "es":"El tinto de la casa, el que se acaba primero en una mesa larga. Fruta roja, tanino suave, sin sermón de barrica. Sírvelo un poco fresco.",
     "price":527,"url":"https://dosbuhos.com/product/mosaico-tinto/","label":"mosaico-tinto","awards":[["92 pts · 2023 vintage","pts"]]},
    {"slug":"tempranillo-1524","name":"1524 Tempranillo","kind_en":"Red","kind_es":"Tinto","grape":"100% Tempranillo · reserva",
     "en":"Plum, blueberry, dark chocolate, a curl of vanilla and smoke. The Tempranillo for a weeknight; the Gran Reserva is for the weekend.",
     "es":"Ciruela, mora azul, chocolate oscuro, un rizo de vainilla y humo. El Tempranillo de entre semana; el Gran Reserva es para el fin.",
     "price":527,"url":"https://dosbuhos.com/product/tempranillo1524/","label":"tempranillo-1524","awards":[]},
    {"slug":"roble","name":"Blend Roble","kind_en":"Red blend · oak","kind_es":"Tinto de mezcla · roble","grape":"Grenache · Syrah · rested in oak",
     "en":"Grenache and Syrah rested in oak. Round, red-fruited, friendly: the bottle for a crowd that wants a red and doesn't want a lecture.",
     "es":"Grenache y Syrah reposados en roble. Redondo, de fruta roja, amable: la botella para un grupo que quiere un tinto y no quiere una cátedra.",
     "price":590,"url":"https://dosbuhos.com/product/blend-roble/","label":"roble","awards":[]},
    {"slug":"seleccion","name":"Selección Especial","kind_en":"Red blend · our first label","kind_es":"Tinto de mezcla · nuestra primera etiqueta","grape":"Cabernet Sauvignon · Cabernet Franc · Aglianico",
     "en":"Our first label, 2012, and still the blend we reach for to explain the place: Cabernet Sauvignon for the spine, Cabernet Franc for the perfume, Aglianico for the acid. Native yeast, unfined, unfiltered.",
     "es":"Nuestra primera etiqueta, 2012, y todavía la mezcla con la que explicamos el lugar: Cabernet Sauvignon para la columna, Cabernet Franc para el perfume, Aglianico para la acidez. Levadura nativa, sin clarificar, sin filtrar.",
     "price":792,"url":"https://dosbuhos.com/product/seleccion-especial/","label":"seleccion","awards":[["92 pts · Catadores","pts"]]},
    {"slug":"grenache","name":"Grenache Gran Reserva","kind_en":"Red · Gran Reserva","kind_es":"Tinto · Gran Reserva","grape":"100% Grenache",
     "en":"Cinnamon, cherry, fine wood, strawberry at the close. Pale for a Gran Reserva and all the better for it. Grand Gold in Brussels, which surprised nobody who had tasted it.",
     "es":"Canela, cereza, madera fina, fresa al cierre. Pálido para un Gran Reserva y mejor por eso. Gran Oro en Bruselas, lo que no sorprendió a nadie que lo hubiera probado.",
     "price":939,"url":"https://dosbuhos.com/product/grenache/","label":"grenache","awards":[["Grand Gold · Brussels 2024","cmb"],["Silver · Brussels 2026","cmb"]]},
    {"slug":"tempranillo-gr","name":"Tempranillo Gran Reserva","kind_en":"Red · Gran Reserva","kind_es":"Tinto · Gran Reserva","grape":"100% Tempranillo · 2 years in French oak",
     "en":"Two years in French oak, two more lying down in glass before we let it go. Dark cherry, leather, cedar. The one for the lamb.",
     "es":"Dos años en roble francés y dos más acostado en vidrio antes de soltarlo. Cereza oscura, cuero, cedro. El del cordero.",
     "price":697,"url":"https://dosbuhos.com/product/tempranillo/","label":"tempranillo-gr","awards":[["Gold · Bacchus 2026","bacchus"],["95 pts · Catadores","pts"]]},
    {"slug":"cab-sauvignon","name":"Cabernet Sauvignon Gran Reserva","kind_en":"Red · Gran Reserva","kind_es":"Tinto · Gran Reserva","grape":"100% Cabernet Sauvignon",
     "en":"Green pepper, clove, dark chocolate. Lighter than the name promises, which is the altiplano talking; the tannin is still there for a ribeye.",
     "es":"Pimiento verde, clavo, chocolate oscuro. Más ligero de lo que promete el nombre, que es el altiplano hablando; el tanino sigue ahí para un rib eye.",
     "price":792,"url":"https://dosbuhos.com/product/cabernet-sauvignon/","label":"cab-sauvignon","awards":[["93 pts · Catadores","pts"],["Silver · Brussels México 2021","cmb"]]},
    {"slug":"cab-franc","name":"Cabernet Franc Gran Reserva","kind_en":"Red · Gran Reserva","kind_es":"Tinto · Gran Reserva","grape":"100% Cabernet Franc",
     "en":"One of a handful of single-varietal Cabernet Francs in Mexico. Raspberry and green pepper, a tannin with manners. Duck, if you can get it.",
     "es":"Uno de los pocos Cabernet Franc varietales de México. Frambuesa y pimiento verde, un tanino con modales. Pato, si lo consigues.",
     "price":939,"url":"https://dosbuhos.com/product/cabernet-franc/","label":"cab-franc","awards":[["93 pts","pts"]]},
    {"slug":"aglianico","name":"Aglianico Gran Reserva","kind_en":"Red · the flagship","kind_es":"Tinto · el insignia","grape":"100% Aglianico · two barrels a year",
     "en":"Volcanic ground, volcanic grape. Black fruit, cardamom, clove, an acid that refuses to quit. Two barrels a year and most of it spoken for. If you find a bottle, that's the one.",
     "es":"Suelo volcánico, uva volcánica. Fruta negra, cardamomo, clavo, una acidez que no se rinde. Dos barricas al año y casi todas comprometidas. Si encuentras una botella, es esa.",
     "price":1150,"url":"https://dosbuhos.com/product/aglianico/","label":"aglianico","awards":[["97 pts","pts"],["Silver · Brussels 2026","cmb"],["Silver · Los Angeles 2026","la"]]},
    {"slug":"montepulciano","name":"1524 Montepulciano · Vino Generoso","kind_en":"Fortified · after dinner","kind_es":"Generoso · para después","grape":"Montepulciano · fortified, barrel-aged",
     "en":"A fortified Montepulciano in the port manner, aged in barrel until it stopped arguing. Fig, walnut, orange peel. A small glass after dinner, or with the cheese.",
     "es":"Un Montepulciano fortificado a la manera del oporto, criado en barrica hasta que dejó de discutir. Higo, nuez, cáscara de naranja. Una copa chica después de cenar, o con el queso.",
     "price":988,"url":"https://dosbuhos.com/product/montepulciano1524/","label":"montepulciano","awards":[]},
    {"slug":"vin-dorange","name":"1524 Vin d'Orange Amères","kind_en":"Aperitivo · fortified","kind_es":"Aperitivo · generoso","grape":"Estate wine · bitter orange peel · estate botanicals",
     "en":"Wine, bitter orange peel, patience. Our aperitivo: on ice with a twist, or with tonic at six o'clock. A French idea, done our way.",
     "es":"Vino, cáscara de naranja amarga, paciencia. Nuestro aperitivo: en las rocas con un twist, o con tónica a las seis. Una idea francesa, hecha a nuestra manera.",
     "price":988,"url":"https://dosbuhos.com/product/vin-dorange/","label":"vin-dorange","awards":[]},
]

# Awards — from Dos_Búhos_Premios.xlsx + Puntos 2027 (newest first). medal keys: gg=Grand Gold, g=Gold, s=Silver, b=Bronze, m=CMB Merit, p=points
AWARDS = [
  {"comp":"Concours Mondial de Bruxelles","year":2026,"icon":"cmb","items":[["Grenache 2021","s"],["Aglianico 2022","m"],["Anaranjado 2023","m"],["Sauvignon Blanc 2024","m"],["1524 Moscato Giallo 2025","m"]]},
  {"comp":"Bacchus · Unión Española de Catadores","year":2026,"icon":"bacchus","items":[["Tempranillo 2022","g"],["Anaranjado 2023","g"]]},
  {"comp":"Los Angeles International Wine Competition","year":2026,"icon":"la","items":[["Chenin Blanc 2024","s"],["Aglianico 2021","s"],["Tempranillo 2022","b"]]},
  {"comp":"Puntos 2027","year":2027,"icon":"","items":[["Aglianico 2020","97 pts"],["Tempranillo 2022","93 pts"],["Cabernet Franc Gran Reserva 2022","93 pts"],["1524 Mosaico Tinto 2023","92 pts"],["Chenin Blanc 2024","89 pts"],["Grenache Gran Reserva 2021","88 pts"]]},
  {"comp":"Concours Mondial de Bruxelles","year":2025,"icon":"cmb","items":[["Tempranillo 2020","s"],["Sauvignon Blanc 2024","s"]]},
  {"comp":"Los Angeles International Wine Competition","year":2025,"icon":"la","items":[["Moscato Giallo Pet Nat 2022","g"],["Espumoso Rosado 2020","s"],["Aglianico 2020","s"]]},
  {"comp":"Concours Mondial de Bruxelles","year":2024,"icon":"cmb","items":[["Grenache 2019","gg"],["Anaranjado 2021","s"],["1524 Espumoso Blanco 2022","s"],["Grenache 2020","s"]]},
  {"comp":"Los Angeles International Wine Competition","year":2024,"icon":"la","items":[["Chenin Blanc 2022","b"]]},
  {"comp":"Catadores del Vino Mexicano","year":0,"icon":"","items":[["1524 Espumoso Rosé 2022","95 pts"],["Tempranillo 2020","95 pts"],["1524 Espumoso Blanco 2022","93 pts"],["Cabernet Sauvignon 2020","93 pts"],["Selección Especial 2017","92 pts"],["Chardonnay 2021","92 pts"],["Sauvignon Blanc 2020","91 pts"],["Tempranillo 2016","91 pts"],["Aglianico 2015","91 pts"],["Moscato Giallo Pet Nat 2021","91 pts"],["Espumoso Rosado 2020","91 pts"],["Chenin Blanc 2022","90 pts"],["Grenache 2020","90 pts"]]},
  {"comp":"Concours Mondial de Bruxelles · México","year":2023,"icon":"cmb","items":[["Moscato Giallo Pet Nat 2021","s"]]},
  {"comp":"Concours Mondial de Bruxelles · México","year":2022,"icon":"cmb","items":[["Sauvignon Blanc 2021","s"]]},
  {"comp":"Concours Mondial de Bruxelles · México","year":2021,"icon":"cmb","items":[["Cabernet Sauvignon 2017","s"]]},
]

# Videos — poster may be a remote URL (YouTube thumb) with a local fallback layered under it. Each: title (en/es), blurb (en/es), poster (image in public/), and either src (mp4/HLS URL, e.g. Cloudflare Stream/R2) or embed (YouTube/Vimeo embed URL); dur optional. Empty src+embed = "coming soon" card.
VIDEOS = [
    {"title_en": "Bodega Dos Búhos, San Miguel de Allende", "title_es": "Bodega Dos Búhos, San Miguel de Allende",
     "blurb_en": "A visit from Guía de Vinos Mexicanos: the vineyard, the cellar, the people.", "blurb_es": "Una visita de Guía de Vinos Mexicanos: el viñedo, la bodega, la gente.",
     "poster": "https://i.ytimg.com/vi/F3VZHRI4G6o/hqdefault.jpg", "fallback": "/photos/cellar.jpg", "src": "", "embed": "https://www.youtube-nocookie.com/embed/F3VZHRI4G6o?rel=0&modestbranding=1&playsinline=1&autoplay=1", "dur": ""},
    {"title_en": "Dos Búhos — an introduction", "title_es": "Dos Búhos — introducción",
     "blurb_en": "Who we are and why we farm this way, in one minute.", "blurb_es": "Quiénes somos y por qué cultivamos así, en un minuto.",
     "poster": "/videos/introduccion.jpg", "src": "/videos/introduccion.mp4", "embed": "", "dur": "0:57"},
]
PHOTOS = [
    # order: freshest first, most-used shots last (community / Feed The Hungry removed)
    {"f": "photos/ab-garden-chapel.jpg", "pos": "50% 40%", "en": "The garden and the chapel", "es": "El jardín y la capilla"},
    {"f": "photos/seated-tasting.jpg", "pos": "60% 40%", "en": "Four wines, poured at the table", "es": "Cuatro vinos, servidos en la mesa"},
    {"f": "photos/ab-bar-bottles-chapel.jpg", "pos": "50% 62%", "en": "Gran Reserva at the bar", "es": "Gran Reserva en la barra"},
    {"f": "photos/ab-chapel-fountain.jpg", "pos": "50% 55%", "en": "The chapel courtyard", "es": "El patio de la capilla"},
    {"f": "photos/ab-barrel-chalk.jpg", "en": "Petite Syrah, 2026, in barrel", "es": "Petite Syrah 2026 en barrica"},
    {"f": "photos/ab-cellar-founders.jpg", "pos": "50% 40%", "en": "In the cellar", "es": "En la bodega"},
    {"f": "photos/ab-barrel-racks.jpg", "pos": "50% 45%", "en": "The barrel room", "es": "La sala de barricas"},
    {"f": "photos/ab-wine-shop.jpg", "pos": "50% 40%", "en": "The wine shop", "es": "La tienda de vinos"},
    {"f": "photos/ab-barrel-monogram.jpg", "en": "The house monogram", "es": "El monograma de la casa"},
    {"f": "photos/ab-barrel-dark.jpg", "en": "Barrels at rest", "es": "Barricas en reposo"},
    {"f": "photos/ab-wood-sign.jpg", "en": "Dos Búhos", "es": "Dos Búhos"},
    {"f": "photos/petanque.jpg", "en": "Pétanque in the garden", "es": "Petanca en el jardín"},
    {"f": "photos/winegarden-night.jpg", "en": "The Winegarden at night", "es": "El Winegarden de noche"},
    {"f": "photos/bodega-arte.jpg", "en": "Bodega de Arte, set for dinner", "es": "La Bodega de Arte, lista para cenar"},
    {"f": "photos/wedding-toast.jpg", "en": "A toast in the Bodega de Arte", "es": "Un brindis en la Bodega de Arte"},
    {"f": "photos/hacienda.jpg", "en": "The whole estate, yours for a day", "es": "La hacienda completa, por un día"},
    {"f": "photos/lunch-table.jpg", "en": "Lunch under the trees", "es": "Comida bajo los árboles"},
    {"f": "photos/glasses.jpg", "en": "Espontáneo, our orange wine", "es": "Espontáneo, nuestro vino naranja"},
    {"f": "photos/pouring.jpg", "en": "Espontáneo, poured", "es": "Espontáneo, al servir"},
    {"f": "photos/candle-sparkling.jpg", "pos": "50% 45%", "en": "An evening in the Winegarden", "es": "Una noche en el Winegarden", "lowres": True},
    {"f": "photos/event-table-courtyard.jpg", "pos": "50% 55%", "en": "A table set in the courtyard", "es": "Mesa puesta en el patio", "lowres": True},
    {"f": "photos/cross-fountain-pergola.jpg", "pos": "50% 25%", "en": "The Winegarden fountain", "es": "La fuente del Winegarden", "lowres": True},
    {"f": "photos/chapel-facade.jpg", "pos": "50% 10%", "en": "The chapel", "es": "La capilla", "lowres": True},
    {"f": "photos/welcome-bicycle.jpg", "pos": "50% 55%", "en": "Welcome", "es": "Bienvenidos", "lowres": True},
    {"f": "photos/orange-wine-table.jpg", "pos": "50% 62%", "en": "Espontáneo at the table", "es": "Espontáneo en la mesa", "lowres": True},
    {"f": "photos/kids-grapes.jpg", "pos": "50% 35%", "en": "Harvest, all ages", "es": "Vendimia para todas las edades", "lowres": True},
    {"f": "photos/engagement-couple.jpg", "pos": "50% 30%", "en": "She said yes, in the vines", "es": "Dijo que sí, entre las vides", "lowres": True},
    {"f": "photos/vineyard-grapes-woman.jpg", "pos": "50% 28%", "en": "Tasting from the vine", "es": "Probando de la vid", "lowres": True},
    {"f": "photos/fountain-courtyard.jpg", "pos": "50% 22%", "en": "The hacienda courtyard", "es": "El patio de la hacienda", "lowres": True},
    {"f": "photos/higinio-orange-truck.jpg", "pos": "50% 28%", "en": "Higinio and the orange truck", "es": "Higinio y la camioneta naranja", "lowres": True},
    {"f": "photos/vineyard-talk.jpg", "en": "In the vineyard", "es": "En el viñedo"},
    {"f": "photos/harvest.jpg", "en": "Harvest at dawn", "es": "Vendimia al amanecer"},
    {"f": "photos/recorrido.jpg", "en": "The vineyard walk", "es": "El recorrido"},
    {"f": "photos/harvest-bin.jpg", "en": "Chenin Blanc into the bin", "es": "Chenin Blanc a la tina"},
    {"f": "photos/planting.jpg", "en": "Planting the first vines, 2006", "es": "Plantando las primeras vides, 2006"},
    {"f": "photos/family-road.jpg", "en": "Four generations on this road", "es": "Cuatro generaciones en este camino"},
    {"f": "photos/cellar.jpg", "en": "Amphora, native-yeast ferments, barrels, sheep", "es": "Ánforas, fermentaciones con levadura nativa, barricas, borregos"},
    {"f": "photos/grandfather.jpg", "en": "The land before the vines", "es": "La tierra antes de las vides"},
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
html = html.replace("__AWARDS_JS__", json.dumps(AWARDS, ensure_ascii=False)).replace("__WINES_JS__", json.dumps(WINES_APP, ensure_ascii=False)).replace("__VIDEOS_JS__", json.dumps(VIDEOS, ensure_ascii=False)).replace("__PEOPLE__", json.dumps(PEOPLE, ensure_ascii=False)).replace("__QR__", json.dumps(qr)).replace("__PHOTOS__", json.dumps(PHOTOS, ensure_ascii=False))
open(os.path.join(PUB, "index.html"), "w", encoding="utf-8").write(html)

# manifests
for k, p in PEOPLE.items():
    m = {"name": "Dos Búhos Business Card", "short_name": "Business Card",
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
        rows.append(f'<tr><td class="w">{wine}</td><td class="m"><span class="en">{en}</span><span class="es">{es}</span></td><td>{a["comp"]}{(" " + str(a["year"])) if a["year"] and a["comp"] != "Puntos 2027" else ""}</td></tr>')
press = press.replace("__AWARDS_TABLE__", "<table class=\"aw\"><tr><th class=\"en\">Wine</th><th class=\"es\">Vino</th><th class=\"en\">Award</th><th class=\"es\">Premio</th><th class=\"en\">Competition</th><th class=\"es\">Concurso</th></tr>" + "\n".join(rows) + "</table>")
press = press.replace("__WINES__", "\n".join(wine_html(w) for w in WINES)).replace("__PHOTOS__", json.dumps(PHOTOS, ensure_ascii=False))
press = press.replace("__OPENTABLE__", LINKS["OPENTABLE"]).replace("__MAPS__", LINKS["MAPS"]).replace("__WA_MAIN__", WA_MAIN).replace("__PRESS_EMAIL__", PRESS_EMAIL).replace("__MARKETING_EMAIL__", MARKETING_EMAIL)
os.makedirs(os.path.join(PUB, "press"), exist_ok=True)
open(os.path.join(PUB, "press", "index.html"), "w", encoding="utf-8").write(press)

# service worker
precache = ["/", "/index.html", "/press/", "/press/index.html", "/icons/logo.png", "/photos/harvest.jpg", "/icons/mono-dark.png", "/icons/mono-light.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"] + [f"/fonts/{f}" for f in os.listdir(os.path.join(PUB, "fonts"))] + \
           [f"/manifest-{k}.webmanifest" for k in PEOPLE] + [f"/vcf/{k}.vcf" for k in PEOPLE] + ["/" + p["f"] for p in PHOTOS]
sw = """// Dos Búhos card — pages network-first with cache fallback; assets cache-first, refreshed in background
const VERSION = 'v__VER__';
const PRECACHE = __PRECACHE__;
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // fonts etc.: network, browser cache
  if (url.pathname === '/version.json') return; // always live
  const isNav = e.request.mode === 'navigate';
  const key = isNav ? (url.pathname.startsWith('/press') ? '/press/index.html' : '/index.html') : e.request;
  e.respondWith(caches.open(VERSION).then(async c => {
    const cached = await c.match(key);
    const net = fetch(e.request).then(r => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    if (isNav) {   // pages: network first (fresh after a deploy), cache if offline or slow
      const fresh = await Promise.race([net, new Promise(res => setTimeout(() => res(null), 2500))]);
      return fresh || cached || (await net) || Response.error();
    }
    return cached || (await net) || Response.error();
  }));
});
"""
import time
VER = time.strftime("%Y%m%d%H%M")
sw = sw.replace("__VER__", VER).replace("__PRECACHE__", json.dumps(precache))
with open(os.path.join(PUB, "version.json"), "w") as f: f.write(json.dumps({"v": VER}))
with open(os.path.join(PUB, "index.html"), "r", encoding="utf-8") as f: _h = f.read()
with open(os.path.join(PUB, "index.html"), "w", encoding="utf-8") as f: f.write(_h.replace("__VER__", VER))
open(os.path.join(PUB, "sw.js"), "w").write(sw)

open(os.path.join(PUB, "_headers"), "w").write("""/vcf/*
  Content-Type: text/vcard; charset=utf-8
  Content-Disposition: attachment
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/version.json
  Cache-Control: no-store
/*.webmanifest
  Content-Type: application/manifest+json
/photos/*
  Access-Control-Allow-Origin: *
""")

print("built", len(html), "bytes;", len(precache), "precached")
