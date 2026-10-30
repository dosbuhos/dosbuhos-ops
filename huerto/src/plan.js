// GENERADO por app/build.py a partir de app/plan-data.js y app/engine.js. No editar a mano.
// Huerto Orgánico Dos Búhos — datos del plan (año 1: oct 2026 – oct 2027)
// Rendimientos y tiempos son estimaciones de partida para 2,000 m; se calibran con el registro real de cosecha.
const CROPS = {
  kale:       {en:"Tuscan kale", char:5, rows:2, esp:0.45, n:"Kale toscano", c:"#2f5d3a", met:"plántula", dist:"2 hileras sobre las líneas de goteo, una planta cada 45 cm", sem:6, dur:18, kg:2.0, u:"kg", cos:25, menu:"Kale Toscano · ensalada del Rib Eye", mo:1, nota:"Cortar hojas de abajo hacia arriba; dejar siempre 6 hojas en el centro."},
  acelga:     {en:"Rainbow chard", char:5, rows:2, esp:0.3, n:"Acelga arcoíris", c:"#b8475b", met:"plántula", dist:"2 hileras sobre goteo, una planta cada 30 cm", sem:6, dur:20, kg:2.0, u:"kg", cos:25, menu:"Guarnición al fuego · tabla de vegetales", mo:1, nota:"Cortar pencas exteriores a ras; rebrota."},
  mostaza:    {en:"Mustard greens", rows:4, esp:null, n:"Hoja de mostaza", c:"#7a8f2a", met:"directa", dist:"4 hileras (2 junto a cada línea de goteo) a chorrillo; ralear a 15 cm", sem:5, dur:7, kg:1.5, u:"kg", cos:20, ralear:true, menu:"Mostaza fermentada para Ejotes al Fuego", mo:1, nota:"Entregar en lotes para fermentar."},
  col:        {en:"Cabbage", char:5, rows:2, esp:0.5, n:"Col (repollo)", c:"#6f9a8d", met:"plántula", dist:"2 hileras sobre goteo, una planta cada 50 cm", sem:12, dur:4, kg:6.0, u:"kg", cos:20, menu:"Tacos de Pato (col fresca)", mo:1, nota:"Cosechar cuando la cabeza esté firme."},
  poro:       {en:"Leek", char:9, rows:3, esp:0.15, n:"Poro", c:"#9fb07a", met:"plántula", dist:"3 hileras, una planta cada 15 cm, enterrar hasta las primeras hojas", sem:16, dur:8, kg:2.5, u:"kg", cos:20, menu:"Crema de Zanahoria · Rack de Cordero", mo:1, nota:"Arrimar tierra al tallo a los 2 meses para blanquear."},
  zanahoria:  {en:"Baby carrot", rows:4, esp:null, n:"Zanahoria baby", c:"#e07b2c", met:"directa", dist:"4 hileras a chorrillo, 1 cm de profundidad; ralear a 4 cm a las 3 semanas", sem:10, dur:4, kg:2.5, u:"kg", cos:30, ralear:true, menu:"Crema de Zanahoria Baby Rostizada · tabla de vegetales", mo:2, nota:"Mantener la tierra húmeda hasta que germine (10–14 días)."},
  betabel:    {en:"Beet", rows:4, esp:null, n:"Betabel", c:"#7b1f3a", met:"directa", dist:"4 hileras, una semilla cada 5 cm; ralear a 10 cm", sem:9, dur:4, kg:3.5, u:"kg", cos:25, ralear:true, menu:"Hummus de betabel · hojas tiernas en ensalada", mo:1, nota:"Las hojas del raleo van a cocina."},
  rabano:     {en:"Radish", rows:4, esp:null, n:"Rábano", c:"#d6455f", met:"directa", dist:"4 hileras, una semilla cada 3 cm; ralear a 5 cm", sem:4, dur:2, kg:4.0, u:"kg", cos:20, ralear:true, menu:"Tabla de vegetales · encurtidos de la casa", mo:1, nota:"Cosechar pronto: se ahuecan si se pasan."},
  lechuga:    {en:"Cut lettuce mix", rows:4, esp:null, n:"Lechuga roja (de corte)", c:"#8fc25a", met:"directa", dist:"4 hileras a chorrillo", sem:5, dur:6, kg:1.5, u:"kg", cos:30, menu:"Capo di Casa · ensalada del Rib Eye", mo:1, nota:"Cortar a 5 cm del suelo; rebrota 2–3 veces. De abril a junio con malla sombra."},
  arugula:    {en:"Arugula", rows:4, esp:null, n:"Arúgula", c:"#4f7a2b", met:"directa", dist:"4 hileras a chorrillo", sem:4, dur:5, kg:1.2, u:"kg", cos:25, menu:"Hamburguesa de Alcachofa · pizza Blanca", mo:1, nota:"Cortar joven; las flores también se usan."},
  cilantro:   {en:"Cilantro", rows:4, esp:null, n:"Cilantro", c:"#5aa36b", met:"directa", dist:"4 hileras a chorrillo", sem:6, dur:4, kg:1.0, u:"kg", cos:20, menu:"Tacos de Pato · Mexa · salsas", mo:1, nota:"Se espiga con calor; cosechar completo."},
  eneldo:     {en:"Dill", rows:3, esp:null, n:"Eneldo", c:"#a7c957", met:"directa", dist:"3 hileras a chorrillo; ralear a 15 cm", sem:7, dur:6, kg:0.5, u:"kg", cos:15, ralear:true, menu:"Rack de Cordero · encurtidos", mo:1, nota:""},
  haba:       {en:"Fava bean", rows:2, esp:0.2, n:"Haba", c:"#5b6e3b", met:"directa", dist:"2 hileras sobre goteo, una semilla cada 20 cm a 4 cm de profundidad", sem:18, dur:5, kg:2.0, u:"kg", cos:30, menu:"Habas frescas de primavera · puntas tiernas en ensalada", mo:1, nota:"Fija nitrógeno: dejar la raíz en la cama al retirar."},
  chicharo:   {en:"Snow pea", rows:2, esp:null, n:"Chícharo chino", c:"#76b06c", met:"directa", dist:"2 hileras sobre goteo, una semilla cada 5 cm; malla de 1.2 m al centro", sem:11, dur:5, kg:1.2, u:"kg", cos:35, tutor:true, menu:"Chícharo chino y guías tiernas de primavera", mo:2, nota:"Cosechar cada 2 días."},
  ejote:      {en:"Green bean", rows:2, esp:null, n:"Ejote de mata", c:"#3d8b4f", met:"directa", dist:"2 hileras sobre goteo, una semilla cada 10 cm", sem:8, dur:5, kg:1.0, u:"kg", cos:50, menu:"Ejotes del Huerto al Fuego · acompañamiento", mo:2, nota:"Cosechar cada 2 días, delgados como lápiz."},
  calabacita: {en:"Zucchini & squash blossom", rows:1, esp:0.8, n:"Calabacita y flor", c:"#c9b02f", met:"directa", dist:"1 hilera al centro, 2 semillas cada 80 cm (dejar la mejor)", sem:7, dur:10, kg:3.0, u:"kg", cos:30, menu:"Ensalada de Calabacín · flor de calabaza", mo:1, nota:"Cortar a 15–18 cm. Flores macho temprano por la mañana."},
  jitomate:   {en:"Cherry tomato", char:6, rows:2, esp:0.6, n:"Jitomate cherry", c:"#d9412b", met:"plántula", dist:"2 hileras sobre goteo, una planta cada 60 cm; tutorar con estaca e hilo", sem:10, dur:14, kg:3.0, u:"kg", cos:40, tutor:true, menu:"Ensalada de Calabacín · Gnocchi de Mar · salsas", mo:3, nota:"Quitar chupones cada semana."},
  pepino:     {en:"Persian cucumber", rows:1, esp:null, n:"Pepino persa", c:"#2e9e8f", met:"directa", dist:"1 hilera al centro con malla, 2 semillas cada 40 cm", sem:8, dur:8, kg:3.0, u:"kg", cos:30, tutor:true, menu:"Aguachile Verde de Setas", mo:2, nota:"Guiar las guías a la malla. Se puede intercalar pepino sandía en la misma malla."},
  chile:      {en:"Jalapeño & serrano", char:8, rows:2, esp:0.45, n:"Chile jalapeño y serrano", c:"#2a7d2e", met:"plántula", dist:"2 hileras sobre goteo, una planta cada 45 cm", sem:11, dur:14, kg:1.5, u:"kg", cos:25, menu:"Aguachile · salsas tatemadas · encurtidos", mo:1, nota:""},
  albahaca:   {en:"Basil", char:5, rows:2, esp:0.3, n:"Albahaca", c:"#5c9e3a", met:"plántula", dist:"2 hileras sobre goteo, una planta cada 30 cm", sem:5, dur:16, kg:0.8, u:"kg", cos:20, menu:"Pizzas · ensaladas de verano", mo:1, nota:"Despuntar las flores."},
  tomatillo:  {rows:2, esp:.6, char:6, en:"Tomatillo", n:"Tomate verde", c:"#7fa23a", met:"plántula", dist:"2 hileras sobre goteo, una planta cada 60 cm; dejar que se recueste o poner estaca corta", sem:10, dur:12, kg:3.0, u:"kg", cos:30, menu:"Salsas verdes · aguachile · Mexa", mo:1, nota:"Muy productivo; plantar al menos 2 plantas juntas para que polinicen."},
  quelites:   {en:"Red amaranth greens", rows:4, esp:null, n:"Amaranto rojo (quelite)", c:"#8a3b6e", met:"directa", dist:"4 hileras a chorrillo", sem:4, dur:8, kg:1.5, u:"kg", cos:25, menu:"Quelites de temporada", mo:1, nota:"Cortar puntas tiernas; rebrota."},
  verdolaga:  {en:"Purslane", rows:0, esp:null, n:"Verdolaga", c:"#6b8f3d", met:"directa", dist:"Semilla al voleo, cubrir apenas", sem:5, dur:10, kg:1.5, u:"kg", cos:25, menu:"Verdolagas en salsa verde", mo:1, nota:"Cortar puntas; rebrota con lluvias."},
  huauzontle: {en:"Huauzontle", rows:2, esp:null, n:"Huauzontle", c:"#7e6b3a", met:"directa", dist:"2 hileras, ralear a 20 cm", sem:9, dur:4, kg:2.0, u:"kg", cos:25, ralear:true, menu:"Tortitas de huauzontle", mo:1, nota:"Cosechar antes de que el grano madure."},
  milpa:      {en:"Milpa (corn, beans, squash)", rows:2, esp:0.4, n:"Milpa (maíz, frijol, calabaza)", c:"#d4a72c", met:"directa", dist:"Maíz cada 40 cm en 2 hileras; a las 2 semanas un frijol junto a cada maíz; 2 calabazas en los extremos", sem:13, dur:4, kg:3.0, u:"kg", cos:25, menu:"Elote, flor de calabaza · cama para recorridos y talleres", mo:1, nota:"Cama de muestra para visitas."},
  ajo:        {en:"Garlic & shallot", rows:4, esp:0.12, n:"Ajo y chalote", c:"#cfc3a8", met:"bulbo", dist:"4 hileras: mitad de la cama ajo (un diente cada 12 cm) y mitad chalote (un bulbo cada 15 cm), punta arriba, 3 cm de profundidad", sem:28, dur:3, kg:2.8, u:"kg", cos:30, nofactor:true, menu:"Ajo y chalote de la casa · vinagretas · ajo verde en primavera", mo:1, nota:"Suspender riego 2 semanas antes de cosechar."},
  papa:       {en:"Baby potato", rows:2, esp:0.3, n:"Papa cambray", c:"#a8865a", met:"bulbo", dist:"2 hileras sobre goteo, una papa cada 30 cm a 10 cm de profundidad; aporcar a las 5 semanas", sem:12, dur:3, kg:6.5, u:"kg", cos:40, menu:"Papas cambray al romero · Costillas · Rib Eye", mo:2, nota:""},
  perennes:   {en:"Perennial herbs", rows:2, esp:0.5, n:"Hierbas perennes", c:"#6d7f5e", met:"división", dist:"Bloques de 1 m con las plantas que ya existen: romero, salvia, tomillo y cebollín (dividir matas y hacer esquejes); agregar orégano", sem:8, dur:60, kg:0.4, u:"kg", cos:20, nofactor:true, menu:"Papas al romero · miel de romero · chimichurri · cordero", mo:1, nota:"No hay que comprar: se divide lo que ya está en el huerto. La menta va aparte, en la tina oeste."},
  perejil:    {en:"Parsley", rows:3, esp:0.2, n:"Perejil", c:"#3f8f46", met:"directa", dist:"3 hileras a chorrillo; remojar la semilla una noche; ralear a 20 cm", sem:10, dur:30, kg:0.6, u:"kg", cos:20, nofactor:true, menu:"Chimichurri · acabados", mo:1, nota:""},
  mexicanas:  {en:"Epazote, pápalo & pipicha", rows:3, esp:null, n:"Epazote, pápalo y pipicha", c:"#55703a", met:"directa", dist:"3 hileras a chorrillo, una especie por tramo", sem:6, dur:16, kg:0.6, u:"kg", cos:20, menu:"Frijoles · quesadillas · salsas", mo:1, nota:"El epazote se resiembra solo."},
  apio:       {rows:2, esp:.3, en:"Celery", n:"Apio", c:"#9cc46b", met:"plántula", char:9, dist:"2 hileras sobre goteo, una planta cada 30 cm", sem:14, dur:12, kg:1.5, u:"kg", cos:20, menu:"Fondos, salsas, encurtidos", mo:1, nota:"Cortar pencas exteriores; rebrota."},
  alcachofa:  {rows:1, esp:1, en:"Artichoke", n:"Alcachofa", c:"#6f8a74", met:"división", dist:"Perenne: 1 hilera, una planta por metro; dividir hijuelos en otoño", sem:20, dur:10, kg:1.2, u:"kg", cos:20, nofactor:true, menu:"Hamburguesa de Alcachofa · alcachofa al fuego", mo:1, nota:"Cosecha de marzo a mayo. Cortar el tallo seco en verano y abonar en otoño."},
  hierbabuena:{rows:0, esp:null, en:"Spearmint & mint", n:"Hierbabuena y menta", c:"#4fae86", met:"división", dist:"Perenne: mantener en su tramo; cortar las guías que se salgan", sem:1, dur:60, kg:0.6, u:"kg", cos:15, nofactor:true, menu:"Aguas frescas · cócteles · salsas", mo:1, nota:"Invasiva: no dejar que salga de su metro."},
  cebolla:    {rows:4, esp:.1, en:"Onion", n:"Cebolla", c:"#b07ab8", met:"propia", dist:"Plántula propia (de A2, A3 y A5): 4 hileras, una cada 10 cm, sin enterrar de más", sem:14, dur:10, kg:2.5, u:"kg", cos:25, nofactor:true, menu:"Cebolla caramelizada (Tacos de Pato) · cebollita cambray al fuego", mo:1, nota:"Las primeras se cosechan como cebollita cambray; las demás se dejan engordar."},
  semilla:    {rows:0, esp:null, en:"Seed saving", n:"Planta para semilla", c:"#b9a77a", met:"existente", dist:"Dejar secar en la planta", sem:0, dur:4, kg:0, u:"kg", cos:0, nokg:true, semilla:true, menu:"Semilla propia para la siguiente siembra", mo:1, nota:""},
  vegetales:  {rows:0, esp:null, en:"Mixed vegetables", n:"Vegetales varios (por confirmar)", c:"#8f9c7a", met:"existente", dist:"", sem:0, dur:4, kg:1.0, u:"kg", cos:15, menu:"Tabla de vegetales", mo:1, nota:"Adrián confirma qué son."},
  floresmix:  {rows:0, esp:null, en:"Mixed flowers", n:"Flores mixtas (capuchina, zinnia, cosmos)", c:"#e0743c", met:"existente", dist:"", sem:0, dur:6, kg:80, u:"flores", cos:20, menu:"Capuchina comestible · decoración", mo:1, nota:"Terminan con la primera helada."},
  aciano:     {en:"Cornflower", rows:3, esp:null, n:"Aciano (flor celeste)", c:"#5b7fd6", met:"directa", dist:"3 hileras a chorrillo; ralear a 20 cm", sem:11, dur:14, kg:80, u:"flores", cos:30, ralear:true, menu:"Pétalos azules en ensaladas, postres y cócteles", mo:1, nota:"Resiste helada: se siembra en otoño."},
  amapola:    {en:"California poppy", rows:3, esp:null, n:"Amapola de California", c:"#f28c28", met:"directa", dist:"Al voleo en 3 franjas, cubrir apenas; ralear a 20 cm", sem:12, dur:10, kg:60, u:"flores", cos:20, ralear:true, menu:"Decorativa: mesas y arreglos (no se sirve en plato)", mo:1, nota:"Resiste helada y se resiembra sola."},
  decor:      {en:"Cut flowers: zinnia, cosmos, sunflower", rows:2, esp:null, n:"Flores de corte (zinnia, cosmos, girasol)", c:"#c94f7c", met:"directa", dist:"2 hileras sobre goteo: zinnia y cosmos alternados, 2 semillas cada 30 cm; girasol en la orilla", sem:9, dur:14, kg:60, u:"flores", cos:30, ralear:true, menu:"Decorativa: floreros de mesa y eventos (no se sirve en plato)", mo:1, nota:"Cortar en la mañana; entre más se corta, más florece. Termina con la primera helada."},
  viola:      {en:"Viola & pansy", char:9, rows:4, esp:0.25, n:"Pensamiento y viola", c:"#7d5ba6", met:"plántula", dist:"4 hileras, una planta cada 25 cm", sem:4, dur:22, kg:200, u:"flores", cos:35, menu:"Postres · ensaladas · cócteles", mo:1, nota:"Cortar flores abiertas cada 2–3 días."},
  calendula:  {en:"Calendula", rows:3, esp:null, n:"Caléndula", c:"#f0a020", met:"directa", dist:"3 hileras; ralear a 25 cm", sem:9, dur:22, kg:60, u:"flores", cos:30, ralear:true, menu:"Pétalos en ensaladas y mantequillas", mo:1, nota:""},
  borraja:    {en:"Borage", rows:2, esp:null, n:"Borraja", c:"#4a78c2", met:"directa", dist:"2 hileras; ralear a 40 cm", sem:8, dur:18, kg:120, u:"flores", cos:30, ralear:true, menu:"Cócteles · ensaladas · hielo de flores", mo:1, nota:"Atrae polinizadores."},
  capuchina:  {en:"Nasturtium", rows:2, esp:null, n:"Capuchina", c:"#e8542a", met:"directa", dist:"2 hileras sobre goteo, 2 semillas cada 30 cm", sem:7, dur:22, kg:120, u:"flores", cos:30, menu:"Flor y hoja picante en ensaladas", mo:1, nota:"No resiste helada: sembrar solo de marzo en adelante."},
  cempasuchil:{en:"Marigold (cempasúchil)", rows:2, esp:null, n:"Cempasúchil", c:"#f2a900", met:"directa", dist:"2 hileras sobre goteo; ralear a 35 cm", sem:12, dur:10, kg:40, u:"flores", cos:30, ralear:true, menu:"Pétalos para Día de Muertos · decoración", mo:1, nota:"Florece de septiembre a noviembre."},
};

// Siembras: [cama, cultivo, fecha de siembra (lunes de la semana)]
// Existentes (ex: [inicio de cosecha, fin]) según el reporte de Adrián del 7 oct 2026.
// pos = metros desde el extremo norte (A) u oeste (B); m = metros que ocupa.
const PLANTINGS = [
  // ---------- A-NO ----------
  ["A1","kale","2026-11-16",{note:"Cama completa. Plántula de charola sembrada el 14 oct (era para B6)"}],
  ["A1","jitomate","2027-04-05"],
  ["A2","apio","",{ex:["2026-10-26","2027-01-17"],pos:0,m:3}],
  ["A2","mostaza","2026-10-26",{pos:3,m:2}],
  ["A2","arugula","2027-01-25",{pos:0,m:3}],
  ["A2","rabano","2027-01-25",{pos:3,m:2}],
  ["A2","jitomate","2027-04-05"],
  ["A3","lechuga","2026-10-26",{pos:0,m:2.5}],
  ["A3","rabano","2026-10-26",{pos:2.5,m:2.5}],
  ["A3","lechuga","2027-01-11"],
  ["A3","calabacita","2027-05-03"],
  ["A4","perennes","",{ex:["2026-10-12","2027-10-17"],pos:0,m:1,note:"Orégano (se queda)"}],
  ["A4","betabel","",{ex:["2026-10-12","2026-11-08"],pos:1,m:2,note:"Supuesto: 2 m de betabel"}],
  ["A4","zanahoria","",{ex:["2026-10-12","2026-11-08"],pos:3,m:1}],
  ["A4","lechuga","2026-10-26",{pos:4,m:1,note:"Donde estaba el ajenjo"}],
  ["A4","acelga","2026-11-23",{d:1,pos:1,m:3}],
  ["A4","calabacita","2027-05-24",{pos:1,m:4}],
  ["A5","hierbabuena","",{ex:["2026-10-12","2027-10-17"],pos:0,m:1}],
  ["A5","betabel","2026-10-26",{pos:1,m:4}],
  ["A5","lechuga","2027-02-08",{pos:1,m:4}],
  ["A5","pepino","2027-05-03",{pos:1,m:4}],
  ["A6","zanahoria","",{ex:["2026-10-12","2026-11-08"]}],
  ["A6","col","2026-11-16"],
  ["A6","chile","2027-04-12"],
  // ---------- A-NE ----------
  ["A7","haba","2026-10-26",{note:"Cama completa"}],
  ["A7","ejote","2027-06-07"],
  ["A8","ejote","",{ex:["2026-10-12","2026-11-22"],pos:0,m:2,note:"Frijol (se queda hasta la helada)"}],
  ["A8","ajo","2026-11-02",{pos:2,m:3}],
  ["A8","arugula","2026-11-30",{pos:0,m:2}],
  ["A8","ejote","2027-06-28"],
  ["A9","cebolla","2026-10-12"],
  ["A9","ejote","2027-05-17"],
  ["A10","jitomate","",{ex:["2026-10-26","2026-11-29"],pos:0,m:3}],
  ["A10","acelga","2026-10-26",{d:1,pos:3,m:2}],
  ["A10","lechuga","2026-12-14",{pos:0,m:3}],
  ["A10","rabano","2027-03-15",{pos:0,m:3}],
  ["A10","ejote","2027-05-17"],
  ["A11","tomatillo","",{ex:["2026-11-09","2026-12-06"],pos:0,m:1,note:"Tomate verde"}],
  ["A11","jitomate","",{ex:["2026-11-16","2026-12-06"],pos:1,m:1,note:"Apenas floreando: puede no alcanzar antes de la helada"}],
  ["A11","col","",{ex:["2026-10-26","2026-11-22"],pos:2,m:2}],
  ["A11","eneldo","2026-10-26",{pos:4,m:1}],
  ["A11","poro","2026-12-14",{pos:0,m:4}],
  ["A11","quelites","2027-07-12"],
  ["A12","alcachofa","",{ex:["2027-03-01","2027-05-09"],note:"Perenne: se queda"}],
  // ---------- A-SO ----------
  ["A13","lechuga","2026-11-09",{pos:0,m:2.5,t:true,char:4,esp:.25,note:"Plántula de charola sembrada el 14 oct"}],
  ["A13","arugula","2026-10-26",{pos:2.5,m:2.5}],
  ["A13","lechuga","2027-01-25"],
  ["A13","lechuga","2027-04-19"],
  ["A13","verdolaga","2027-07-05"],
  ["A14","cilantro","",{ex:["2026-10-12","2026-11-08"],pos:0,m:1}],
  ["A14","cilantro","",{ex:["2026-11-23","2026-12-27"],pos:1,m:4,note:"Recién nacido"}],
  ["A14","lechuga","2027-01-04"],
  ["A14","lechuga","2027-04-12"],
  ["A14","lechuga","2027-08-02"],
  ["A15","betabel","",{ex:["2026-10-12","2026-10-18"],pos:0,m:2,note:"Sacar esta semana"}],
  ["A15","cebolla","2026-10-26",{note:"Tercera cama de cebolla propia"}],
  ["A15","arugula","2027-04-26"],
  ["A15","huauzontle","2027-06-21"],
  ["A16","cebolla","2026-10-12"],
  ["A16","ejote","2027-07-05"],
  ["A17","lechuga","2026-11-16",{pos:0,m:2.5,t:true,char:5,esp:.25,note:"Plántula de charola sembrada el 14 oct"}],
  ["A17","zanahoria","2026-10-26",{pos:2.5,m:2.5}],
  ["A17","lechuga","2027-01-18",{pos:0,m:2.5}],
  ["A17","eneldo","2027-03-15"],
  ["A17","acelga","2027-05-17"],
  ["A18","mostaza","2026-10-26",{pos:0,m:2.5}],
  ["A18","eneldo","2026-10-26",{pos:2.5,m:2.5}],
  ["A18","kale","2027-04-19"],
  // ---------- A-SE ----------
  ["A19","chicharo","2026-10-26",{note:"Cama preparada bajo malla"}],
  ["A19","zanahoria","2027-02-22"],
  ["A19","calabacita","2027-06-14"],
  ["A20","albahaca","",{ex:["2026-10-12","2026-11-15"],pos:0,m:3}],
  ["A20","lechuga","2026-11-16",{pos:3,m:2,t:true,char:5,esp:.25,note:"Plántula de charola sembrada el 14 oct"}],
  ["A20","cilantro","2026-11-30",{pos:0,m:3}],
  ["A20","ejote","2027-04-12"],
  ["A20","betabel","2027-07-19"],
  ["A21","col","",{ex:["2026-10-12","2026-11-01"],pos:0,m:2}],
  ["A21","col","",{ex:["2026-10-26","2026-11-22"],pos:2,m:3}],
  ["A21","zanahoria","2026-12-14"],
  ["A21","albahaca","2027-05-17"],
  ["A22","perejil","",{ex:["2026-10-12","2027-03-28"],pos:0,m:3}],
  ["A22","hierbabuena","",{ex:["2026-10-12","2027-10-17"],pos:3,m:1}],
  ["A22","cilantro","2026-10-26",{pos:4,m:1,note:"Metro con sombra"}],
  ["A22","betabel","2027-04-05",{pos:0,m:3}],
  ["A22","ejote","2027-07-12",{pos:0,m:3}],
  ["A23","zanahoria","",{ex:["2026-10-26","2026-11-22"],pos:0,m:2}],
  ["A23","pepino","",{ex:["2026-10-12","2026-11-08"],pos:2,m:2.5,note:"Pepinillo"}],
  ["A23","zanahoria","2026-12-21"],
  ["A23","zanahoria","2027-04-26"],
  ["A23","rabano","2027-08-09"],
  ["A24","zanahoria","",{ex:["2026-10-26","2026-11-22"],pos:0,m:3}],
  ["A24","betabel","2026-11-23",{pos:3,m:2}],
  ["A24","lechuga","2026-12-14",{pos:0,m:3}],
  ["A24","chile","2027-04-05"],
  // ---------- Sección B: solo flores (comestibles y decorativas) ----------
  ["B1","capuchina","",{ex:["2026-10-12","2026-11-22"],note:"Cama llena de capuchina en flor"}],
  ["B1","viola","2026-12-14"],
  ["B1","capuchina","2027-06-28"],
  ["B2","calendula","2026-11-02"],
  ["B2","cempasuchil","2027-06-14"],
  ["B3","borraja","2026-11-02",{note:"Cama completa"}],
  ["B3","decor","2027-05-17"],
  ["B4","aciano","2026-11-02",{note:"Cama completa"}],
  ["B4","decor","2027-05-10"],
  ["B5","capuchina","",{ex:["2026-10-12","2026-11-22"],note:"Cama llena de capuchina en flor"}],
  ["B5","borraja","2026-11-30",{pos:4.75,m:4.75}],
  ["B5","viola","2027-01-04",{pos:0,m:4.75,note:"Segunda tanda de viola, escalonada"}],
  ["B5","cempasuchil","2027-07-19",{note:"Para Día de Muertos"}],
  ["B6","cempasuchil","",{ex:["2026-10-19","2026-11-08"],note:"Con girasol"}],
  ["B6","decor","2027-04-12",{note:"Descansa con composta y acolchado de noviembre a marzo"}],
  ["B7","floresmix","",{ex:["2026-10-12","2026-11-01"],note:"Zinnia terminando"}],
  ["B7","calendula","2026-11-16"],
  ["B7","decor","2027-07-05"],
  ["B8","cempasuchil","",{ex:["2026-10-26","2026-11-08"]}],
  ["B8","capuchina","2027-03-08",{note:"Descansa con composta y acolchado de noviembre a marzo"}],
  ["B9","cempasuchil","",{ex:["2026-10-12","2026-11-08"]}],
  ["B9","cempasuchil","2027-06-28",{note:"Descansa con composta y acolchado hasta junio. Para Día de Muertos"}],
  ["B10","amapola","2026-11-02",{note:"Cama completa"}],
  ["B10","capuchina","2027-04-26"],
];

const EXTRA_TASKS = [
  // Arranque: miércoles 14 a viernes 16 de octubre
  {w:"2026-10-12", d:3, t:"Reunión de arranque con Eric: revisar el plan, el mapa y cómo mandar fotos y kilos por WhatsApp", min:60, k:"prep"},
  {w:"2026-10-12", d:3, t:"Poner una estaca con su número en cada cama (A1 a A24 y B1 a B10)", min:90, k:"prep"},
  {w:"2026-10-12", d:3, t:"Sacar con cepellón la cebolla de A2, A3 y A5 (se trasplanta a A9 y A16 esta semana; lo que sobre va a A15 la próxima)", min:60, k:"prep"},
  {w:"2026-10-12", d:5, t:"Sacar el betabel de A15 y el ajenjo de A4; mandar el betabel a cocina", min:60, k:"prep"},
  {w:"2026-10-19", d:1, t:"Revisar que llegaron todas las semillas y guardarlas en lugar fresco y seco, con etiqueta", min:30, k:"semillero"},
  {w:"2026-10-19", d:1, t:"Antes de limpiar A1, A3, A7, A13, A17 y A18: cosechar para cocina todo lo que sirva (zanahoria, jitomate cherry, albahaca) y pesarlo. A1 se limpia completa esta semana aunque se siembra hasta el 16 nov: cubrirla con paja", min:150, k:"prep"},
  {w:"2026-10-19", d:1, t:"A7: antes de limpiar, cortar las cabezas de hinojo que ya tengan semilla seca y guardarlas en bolsa de papel", min:20, k:"prep"},
  {w:"2026-10-19", d:2, t:"A3 y A13: sacar la hierbabuena con toda la raíz (si queda un pedazo vuelve a salir); poner 3 matas en maceta para la tina oeste", min:60, k:"prep"},
  {w:"2026-10-19", d:2, t:"A8: dejar los 2 m de frijol del lado norte y limpiar los 3 m del sur", min:45, k:"prep"},
  {w:"2026-11-09", d:3, t:"B6, B8 y B9: al terminar el cempasúchil, sacar las plantas, echar 3 cm de composta y cubrir con paja; descansan hasta la primavera", min:180, k:"prep"},
  {w:"2026-10-19", d:1, t:"Revisar y reparar el goteo de los tramos que se van a sembrar", min:120, k:"prep"},
  {w:"2026-10-26", d:4, t:"Cempasúchil (B6, B8, B9): cortar flores para la ofrenda y la experiencia de Día de Muertos", min:60, k:"cuidado"},
];


// Mejor comprar que cultivar (por espacio, tiempo o clima)
const BUY = [
  {n:"Cebolla (lo que falte)", why:"Se trasplanta la cebolla propia de A2, A3 y A5 a A9 y A16; el resto se compra: 5 meses en cama para un producto barato."},
  {n:"Jengibre", why:"Necesita calor y humedad todo el año; a 2,000 m con heladas no rinde."},
  {n:"Jitomate heirloom", why:"Planta grande, tutoreo y poda semanal para poca cosecha; comprar a productores orgánicos del Bajío. El cherry sí se cultiva."},
  {n:"Papa cambray", why:"Mucho espacio y aporque para un producto barato; el espacio de verdura es solo la sección A."},
  {n:"Maracuyá", why:"Enredadera perenne sensible a helada. Si se quiere probar, una sola planta contra un muro al sur, fuera del plan."},
];

// Experiencias para visitantes (guías en inglés; Adrián prepara en español)
const EXPERIENCES = [
  {id:"recorrido", es:"Recorrido del huerto", en:"Garden walk & tasting", min:40, max:12, when:"Todo el año",
   what:"Caminata por los cuadrantes con el guía: oler hierbas, probar directo de la cama lo que está en cosecha y terminar con una copa en la fuente.",
   uses:["cosecha","perennes"], prep:"Viernes: marcar con banderín 2 camas en cosecha para probar; dejar tijeras y canasta en la tina este.",
   guide:"Explain the four quadrants and crop rotation, organic since 2000, the drip system, and how the beds feed the restaurant menu. Let guests taste 2–3 things straight from the bed.", mat:"Banderines, canasta, tijeras"},
  {id:"ensalada", es:"Cosecha tu ensalada", en:"Pick your own salad", min:45, max:10, when:"Dic – jun",
   what:"Cada visitante corta hojas, hierbas y flores con canasta; cocina la adereza con vinagreta de la casa (verjus y vinagre de vino) y se sirve con un vino blanco.",
   uses:["lechuga","arugula","kale","viola","borraja","calendula","capuchina"], prep:"Viernes: elegir 1 cama de lechuga o arúgula a media cosecha como \"cama de visitas\" y no cosecharla para cocina el fin de semana.",
   guide:"Show how to cut leaves 5 cm above the soil so they regrow. Edible flowers: only the ones on the flower beds. Each guest fills one small basket.", mat:"Canastas chicas, tijeras, tazones"},
  {id:"maceta", es:"Planta y llévatela", en:"Pot a plant to take home", min:40, max:12, when:"Todo el año (la planta cambia por temporada)",
   what:"Cada visitante llena una maceta de barro con sustrato y composta del huerto, trasplanta una plántula del semillero y se la lleva con una tarjeta de cuidados.",
   uses:["semillero"], prep:"Sembrar en el semillero 1 charola extra (72 plántulas) del cultivo de temporada 6 semanas antes; preparar mezcla de sustrato.",
   guide:"Winter: herb cuttings (rosemary, mint, sage). Spring–summer: cherry tomato, basil or chile. September–November: cempasúchil for Day of the Dead. Hand out the care card in English.", mat:"Macetas de barro de 15 cm, sustrato, tarjeta de cuidados bilingüe"},
  {id:"composta", es:"Composta 101", en:"Compost 101", min:45, max:15, when:"Todo el año",
   what:"Manos en la pila: qué entra y qué no, medir la temperatura, voltear, ver lombrices y composta terminada. Se llevan una bolsa de composta y una guía.",
   uses:["composta"], prep:"No voltear la pila esa semana; separar una cubeta de composta terminada y una de restos frescos de cocina.",
   guide:"Greens vs browns, why the pile heats up, how the restaurant scraps return to the beds. Simple enough to do with gestures if needed.", mat:"Termómetro de composta, guantes, bolsas de papel"},
  {id:"siembra", es:"Siembra una hilera", en:"Sow a row (families)", min:30, max:15, when:"Semanas con siembra directa",
   what:"Niños y familias siembran una hilera de rábano, zanahoria o flores en la cama que toca según el plan, y ponen su nombre en una estaca.",
   uses:["directa"], prep:"Dejar sin sembrar una hilera de la siembra directa de esa semana; regla, semilla y estacas listas.",
   guide:"Radishes are ready in about 4 weeks — invite them to come back and harvest. Works with almost no translation.", mat:"Semillas, estacas de madera, marcador"},
  {id:"temporada", es:"Especial de temporada", en:"Seasonal special", min:60, max:12, when:"Oct–nov y ago–sep",
   what:"Oct–nov: cosecha de cempasúchil y armado de un arreglo para ofrenda. Jul–sep: cortar zinnia, cosmos y girasol y armar un ramo para llevar.",
   uses:["cempasuchil","decor"], prep:"Reservar una cama de cempasúchil o de flores de corte (sección B) para el grupo.",
   guide:"Tell the story of cempasúchil and the Day of the Dead, or show how cutting flowers makes the plant bloom more. Section B is the flower garden that dresses the restaurant tables.", mat:"Tijeras, cubetas, cordel"},
];


const PLAN_START = "2026-10-12"; // semana 1: arranque (miércoles 14 a viernes 16)
const FIRST_DAY = 3;
const TRAY_CELLS = 200; // charolas de 200 cavidades (30 compradas) // la semana 1 empieza en miércoles
const PLAN_WEEKS = 53;

// Semillas en bodega (oct 2026)
const STOCK = {
  quelites: "Amaranto rojo",
  calendula: "Caléndula",
  cempasuchil: "Cempasúchil",
  cilantro: "Cilantro",
  chicharo: "Chícharo",
  aciano: "Aciano (flor celeste)",
  amapola: "Amapola de California",
  decor: "Zinnia, cosmos y girasol",
  col: "Col Copenhagen, 800 semillas (llegó 11 oct)",
  viola: "Pensamiento suizo gigante, 600 semillas (llegó 11 oct)",
  rabano: "Rábano Champion, 10,000 semillas (llegó 11 oct)",
  perejil: "Perejil italiano, 6 g (llegó 11 oct)",
  haba: "Haba (llegó 11 oct)",
  betabel: "Betabel Detroit Dark Red, 10 g (llega 13–15 oct)",
  lechuga: "Lechuga roja, 2 × 100 g (llega 13–15 oct)",
  zanahoria: "Zanahoria Nantes, 50 g (llega 13–15 oct)",
  kale: "Kale lacinato, 270 g (llega 13–15 oct)",
};
// Semillas en bodega que no están en el plan de camas: dónde usarlas
const EXTRA_SEEDS = [
  {n:"Conchita azul (Clitoria)", uso:"Flor azul comestible para cócteles y aguas (cambia de color con limón). Necesita calor: sembrar en charola en abril y poner en malla junto al pepino."},
  {n:"Pepino sandía (cucamelon)", uso:"Sembrar en charola en abril y compartir la malla del pepino en A5. Botana para la tabla de vegetales."},
  {n:"Menta limón", uso:"Tina oeste junto a la menta, o macetas para \"Planta y llévatela\". Hoja para aguas frescas y cócteles."},
  {n:"Dalias", uso:"Tina este y orillas de los muros; pétalos comestibles. Sembrar en marzo."},
  {n:"Maravilla", uso:"Solo decorativa: tina este, orillas y bajo los granados. No servir en plato."},
  {n:"Frijol", uso:"Ya no hay milpa en el plan (la sección B es solo flores). Usar en \"Siembra una hilera\" con niños o en A8 en verano."},
];

// Motor del plan: calcula ventanas de cosecha, tareas semanales, horas y pronósticos.
// Cada siembra ocupa un tramo de la cama: pos (m desde el norte en A / desde el oeste en B) y m (metros).
const BEDS = (() => {
  const b = [];
  for (let i = 1; i <= 24; i++) b.push({id: "A" + i, area: 5, len: 5, sec: "A", q: ["A-NO","A-NE","A-SO","A-SE"][Math.floor((i - 1) / 6)]});
  for (let i = 1; i <= 10; i++) b.push({id: "B" + i, area: 13.3, len: 9.5, sec: "B", q: i <= 5 ? "B-O" : "B-E"});
  return b;
})();
const BED = Object.fromEntries(BEDS.map(b => [b.id, b]));
const DAY = 86400000;
const D = s => new Date(s + "T12:00:00");
const wk = s => Math.round((D(s) - D(PLAN_START)) / (7 * DAY));
const wkDate = w => new Date(D(PLAN_START).getTime() + w * 7 * DAY);
const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const MESL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const fmt = d => d.getDate() + " " + MES[d.getMonth()];
const mtxt = m => (Number.isInteger(m) ? m : m.toFixed(1)) + " m";

function factor(sow, crop) {
  if (crop.nofactor) return 1;
  const m = D(sow).getMonth();
  if (m === 10 || m === 11 || m === 0) return 1.3;
  if (m === 9 || m === 1) return 1.15;
  return 1;
}
const overlaps = (a, b) => a.pos < b.pos + b.m - 1e-9 && b.pos < a.pos + a.m - 1e-9;

function buildPlan() {
  const byBed = {};
  const P = PLANTINGS.map(([bed, crop, sow, opt], i) => {
    opt = opt || {};
    const c = CROPS[crop];
    const B = BED[bed];
    const m = opt.m ?? B.len, pos = opt.pos ?? 0;
    const frac = m / B.len;
    const ex = opt.ex || null;
    const s = ex ? 0 : wk(sow);
    const direct = !!opt.d;
    const tray = !ex && ((c.met === "plántula" && !direct) || !!opt.t);
    const char = opt.char ?? c.char;
    const esp = opt.esp ?? c.esp;
    const h0 = ex ? wk(ex[0]) : opt.t ? s + Math.ceil((opt.tsem ?? 3) * factor(sow, c)) : s + Math.ceil((c.sem + (direct && c.char ? c.char : 0)) * factor(sow, c));
    const h1 = ex ? wk(ex[1]) : h0 + c.dur - 1;
    const plants = esp ? c.rows * Math.floor(m / esp) : 0;
    const cells = tray ? Math.ceil(plants * 1.3) : 0;
    const p = {i, bed, crop, c, sow, s, h0, h1, m, pos, frac, ex: !!ex, area: B.area * frac, scale: B.area * frac / 5,
      direct, tray, ts: tray ? s - char : null, plants, cells, trays: Math.ceil(cells / (typeof TRAY_CELLS !== "undefined" ? TRAY_CELLS : 72)), note: opt.note || ""};
    (byBed[bed] = byBed[bed] || []).push(p);
    return p;
  });
  const issues = [];
  P.forEach(p => { if (p.tray && p.ts < 0) issues.push(`${p.bed}: ${p.crop} necesita semillero desde antes del inicio (sem ${p.ts})`); });
  for (const bed of Object.keys(byBed)) {
    const list = byBed[bed].sort((a, b) => a.s - b.s || a.pos - b.pos);
    list.forEach(p => {
      if (p.pos + p.m > BED[bed].len + 1e-9) issues.push(`${bed}: ${p.crop} se sale de la cama`);
      const prev = list.filter(q => q !== p && q.s < p.s && overlaps(p, q));
      const next = list.filter(q => q !== p && q.s > p.s && overlaps(p, q)).sort((a, b) => a.s - b.s)[0];
      const same = list.filter(q => q !== p && q.s === p.s && overlaps(p, q));
      if (same.length) issues.push(`${bed}: ${p.crop} y ${same[0].crop} ocupan el mismo tramo`);
      p.prev = prev.sort((a, b) => b.s - a.s)[0] || null;
      p.first = !p.prev;
      p.end = next ? Math.min(p.h1, next.s - 1) : p.h1;
      if (next && next.s <= p.h0 && !p.c.nokg) issues.push(`${bed}: ${p.crop} (cosecha desde sem ${p.h0}) choca con ${next.crop} sem ${next.s}`);
      if (next && next.s - 1 < p.h1 - 1 && !p.ex) issues.push(`${bed}: ${p.crop} pierde ${p.h1 - (next.s - 1)} sem por ${next.crop}`);
      p.prepW = p.ex ? null : p.first ? Math.max(0, p.s - 1) : p.s;
    });
    // ocupación: una siembra nueva no puede entrar donde hay un cultivo existente activo
    list.forEach(p => list.forEach(q => { if (q !== p && overlaps(p, q) && q.s < p.s && q.end >= p.s) issues.push(`${bed}: ${p.crop} entra (sem ${p.s}) antes de que termine ${q.crop} (sem ${q.end})`); }));
  }
  return {P, byBed, issues};
}

// tramos de una cama en una semana: [{p, st, pos, m}]
function bedSegs(plan, bed, w) {
  const list = plan.byBed[bed] || [];
  const out = [];
  for (const p of list) {
    if (w >= p.s && w <= p.end) out.push({p, st: w >= p.h0 && !p.c.nokg ? "cosecha" : "crece", pos: p.pos, m: p.m});
  }
  for (const p of list) if (w === p.prepW && !out.some(o => overlaps(o, p))) out.push({p, st: "prepara", pos: p.pos, m: p.m});
  return out.sort((a, b) => a.pos - b.pos);
}
// compatibilidad: el tramo más grande
function bedState(plan, bed, w) {
  const s = bedSegs(plan, bed, w).sort((a, b) => b.m - a.m)[0];
  return s ? {p: s.p, st: s.st} : {p: null, st: "libre"};
}

function traysActive(plan, w){ return plan.P.filter(p => p.tray && w >= p.ts && w < p.s); }
const BASE_TASKS = [
  {d:1, t:"Revisar riego: abrir el goteo, caminar cada cama y destapar goteros", min:45},
  {d:4, t:"Deshierbe general de pasillos y camas", min:180},
  {d:5, t:"Fotos por WhatsApp: una foto de cada cuadrante (A-NO, A-NE, A-SO, A-SE, B-O, B-E)", min:20},
  {d:5, t:"Composta: voltear la pila y agregar restos de cosecha", min:45},
  {d:5, t:"Preparar las experiencias de visitantes de la semana (ver pestaña Experiencias)", min:45},
];

function where(p) { return p.frac < 0.999 ? `${p.bed} (${mtxt(p.m)})` : p.bed; }

function weekTasks(plan, w) {
  const T = [];
  const d0 = w === 0 && typeof FIRST_DAY !== "undefined" ? FIRST_DAY : 1;
  BASE_TASKS.forEach((b, k) => T.push({id: "base" + k, d: Math.max(d0, b.d), t: b.t, min: b.min, k: "base"}));
  (typeof EXTRA_TASKS !== "undefined" ? EXTRA_TASKS : []).filter(x => wk(x.w) === w).forEach((x, k) => T.push({id: "x" + w + "-" + k, d: x.d || 1, t: x.t, min: x.min, k: x.k || "prep", bed: x.bed}));
  if (traysActive(plan, w).length || plan.P.some(p => p.tray && p.ts === w)) for (let d = d0; d <= 5; d++) T.push({id: "sem-riego" + d, d, t: "Revisar y regar las charolas del semillero (en la mañana; tapar si hay riesgo de helada)", min: 15, k: "base"});
  for (const p of plan.P) {
    const k = p.area / 5;
    if (p.tray && w === p.ts) T.push({id: `ch${p.i}`, d: 1, b: p.c.n, t: `Sembrar ${p.cells * 2} semillas en charola, 2 por cavidad · Destino: ${where(p)} · Trasplante ≈ ${fmt(wkDate(p.s))} · ${p.c.u === "flores" ? "Flores" : "Cosecha"} ≈ ${fmt(wkDate(p.h0))}`, min: 15 + 20 * p.trays, k: "semillero", bed: p.bed});
    if (p.tray && w === p.s - 1) T.push({id: `en${p.i}`, d: 1, b: p.c.n, t: `Endurecer: sacar la charola al sol y al viento toda la semana y regar menos · Destino: ${where(p)} · Trasplante ≈ ${fmt(wkDate(p.s))} · ${p.c.u === "flores" ? "Flores" : "Cosecha"} ≈ ${fmt(wkDate(p.h0))}`, min: 10, k: "semillero", bed: p.bed});
    if (p.prepW !== null && w === p.prepW) {
      const prev = p.prev;
      const txt = prev
        ? `Preparar ${where(p)}: retirar ${prev.c.n.toLowerCase()}, 2 cm de composta, aflojar con bieldo`
        : `Limpiar ${where(p)}: retirar lo que no se queda, 2 cm de composta, aflojar con bieldo sin voltear`;
      T.push({id: `p${p.i}`, d: 1, t: txt, min: (prev ? 60 : 90) * k, k: "prep", bed: p.bed});
    }
    if (!p.ex && w === p.s) {
      const verbo = p.tray ? "Trasplantar del semillero" : p.c.met === "propia" ? "Trasplantar" : p.c.met === "bulbo" ? "Plantar" : p.c.met === "división" ? "Replantar (dividir matas)" : "Sembrar directo";
      const mm = p.tray || p.c.met === "división" || p.c.met === "propia" ? 45 : p.c.met === "bulbo" ? 45 : 25;
      const how = p.direct ? `semilla directa, ${p.c.rows} hileras sobre goteo; ralear a ${Math.round(p.c.esp * 100)} cm` : p.c.dist;
      T.push({id: `s${p.i}`, d: 2, b: p.c.n, t: `${verbo} en ${where(p)}: ${how}${p.c.nokg ? "" : ` · ${p.c.u === "flores" ? "Flores" : "Cosecha"} ≈ ${fmt(wkDate(p.h0))}`}`, min: mm * k, k: "siembra", bed: p.bed});
    }
    if (!p.ex && (p.c.ralear || p.direct) && w === p.s + 3) T.push({id: `r${p.i}`, d: 3, b: p.c.n, t: `Ralear en ${where(p)}`, min: 30 * k, k: "cuidado", bed: p.bed});
    if (!p.ex && p.c.tutor && w === p.s + 3) T.push({id: `t${p.i}`, d: 3, b: p.c.n, t: `Poner tutor o malla en ${where(p)}`, min: 60 * p.frac, k: "cuidado", bed: p.bed});
    if (p.c.semilla && w === p.end) T.push({id: `sm${p.i}`, d: 3, t: `Cosechar la semilla en ${where(p)}, secarla a la sombra y guardarla en frasco con etiqueta`, min: 45, k: "cuidado", bed: p.bed});
    if (!p.c.nokg && w >= p.h0 && w <= p.end) {
      T.push({id: `h${p.i}`, d: 0, t: `Cosechar ${p.c.n.toLowerCase()} en ${where(p)}`, min: Math.max(10, p.c.cos * p.scale), k: "cosecha", bed: p.bed, crop: p.crop, qty: p.c.kg * p.scale, u: p.c.u});
    }
  }
  // una sola tarea de preparación por cama y semana (camas completas o mitades que se preparan juntas)
  const prepBy = {};
  plan.P.filter(p => p.prepW !== null && w === p.prepW).forEach(p => (prepBy[p.bed] = prepBy[p.bed] || []).push(p));
  for (const [bed, ps] of Object.entries(prepBy)) {
    if (ps.length < 2) continue;
    const ids = new Set(ps.map(p => `p${p.i}`));
    const first = T.findIndex(t => ids.has(t.id));
    const mins = T.filter(t => ids.has(t.id)).reduce((a, t) => a + t.min, 0);
    const m = ps.reduce((a, p) => a + p.m, 0);
    const lbl = m >= BED[bed].len - 1e-9 ? `${bed} (cama completa)` : `${bed} (${mtxt(m)})`;
    const prevs = [...new Set(ps.filter(p => p.prev).map(p => p.prev.c.n.toLowerCase()))];
    const t = prevs.length ? `Preparar ${lbl}: retirar ${prevs.join(" y ")}, 2 cm de composta, aflojar con bieldo` : `Limpiar ${lbl}: retirar lo que no se queda, 2 cm de composta, aflojar con bieldo sin voltear`;
    const keep = {...T[first], t, min: mins};
    for (let j = T.length - 1; j >= 0; j--) if (ids.has(T[j].id)) T.splice(j, 1);
    T.splice(first, 0, keep);
  }
  // repartir trabajo en los días: en orden (semillero → preparar → sembrar → cuidar), sin pasar de ~7.5 h por día
  const harvMin = T.filter(t => t.k === "cosecha").reduce((a, t) => a + t.min, 0);
  const load = [0, 0, 0, 0, 0, 0];
  T.filter(t => t.k === "base").forEach(t => load[t.d] += t.min);
  const hd = [1, 3, 5].filter(d => d >= d0); hd.forEach(d => load[d] += harvMin / hd.length);
  const ord = {semillero: 0, prep: 1, siembra: 2, cuidado: 3};
  const bn = id => id ? id.charCodeAt(0) * 100 + parseInt(id.slice(1)) : 0;
  const work = T.filter(t => t.k in ord).sort((a, b) => ord[a.k] - ord[b.k] || bn(a.bed) - bn(b.bed));
  let day = d0;
  for (const t of work) {
    while (day < 5 && load[day] + t.min > 450) day++;
    t.d = day; load[day] += t.min;
  }
  return T;
}

function weekHours(plan, w) { return weekTasks(plan, w).reduce((a, t) => a + t.min, 0) / 60; }

// pronóstico: por mes calendario, cantidad por cultivo
function forecast(plan) {
  const out = {};
  for (const p of plan.P) { if (p.c.nokg) continue; for (let w = Math.max(0, p.h0); w <= p.end; w++) {
    const d = wkDate(w); d.setDate(d.getDate() + 2);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    out[key] = out[key] || {};
    out[key][p.crop] = (out[key][p.crop] || 0) + p.c.kg * p.scale;
  } }
  return out;
}


export { CROPS, PLANTINGS, EXTRA_TASKS, STOCK, BUY, EXPERIENCES, PLAN_START, PLAN_WEEKS, FIRST_DAY, BEDS, BED, DAY, D, wk, wkDate, fmt, MES, factor, buildPlan, bedSegs, bedState, traysActive, weekTasks, weekHours, forecast, where };
