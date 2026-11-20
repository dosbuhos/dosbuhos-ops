// Made-up rows for local testing only (wrangler dev). Prints SQL for: wrangler d1 execute spark-equipo --local --file
const q = (s) => (s == null ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'");
const d = (n) => { const x = new Date(Date.now() - n * 864e5); return x.toISOString().slice(0, 10); };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = (a) => a[Math.floor(rnd() * a.length)];
const out = [];
const cuentas = { 'José Luis': ['atrio', 'feliciana', 'maria xoconostle', 'smda hoteles', 'rosewood mayakoba', 'la doña', 'quince', 'bovine', 'hotel matilda', 'casa dragones', 'el pegaso', 'trazo 1810', 'numu'],
  Carlos: ['cactus wine', 'acuyo', 'vinoteca', 'la europea mty', 'hotel xcaret', 'pangea', 'koli', 'la nacional'], Daniel: ['vivid', 'rosetta', 'máximo', 'contramar', 'em', 'pujol', 'la docena', 'lardo'] };
for (const [p, cs] of Object.entries(cuentas)) for (let day = 75; day >= 0; day--) {
  const dow = new Date(Date.now() - day * 864e5).getUTCDay(); if (dow === 0 || dow === 6) continue;
  const wk = Math.floor(day / 7), n = wk === 4 && p !== 'Daniel' ? 0 : p === 'Carlos' && day < 9 ? 0 : Math.floor(rnd() * (p === 'José Luis' ? 9 : 5));
  for (let i = 0; i < n; i++) { const act = pick(['Prospección', 'Seguimiento', 'Seguimiento', 'Cobranza', 'Cata / prueba de vino', 'Visita']);
    out.push(`INSERT INTO activity (persona,fecha,zona,cuenta,actividad,medio,etapa,resultado,siguiente_paso,proximo) VALUES (${[p, d(day), 'SMA', pick(cs), act, pick(['Presencial', 'WhatsApp', 'Llamada']), pick(['Contacto inicial', 'Catalogado', 'Compra regular', 'Negociación']), 'Nota de prueba: se habló con compras y quedaron de revisar la carta de vinos.', rnd() < 0.1 ? 'Cerrado' : '', rnd() < 0.7 ? d(day - 7 - Math.floor(rnd() * 20)) : ''].map(q).join(',')});`); }
}
const cli = [['c1', 'SMDA HOTELES', 'José Luis Perez'], ['c2', 'ROSEWOOD MAYAKOBA', 'José Luis Perez'], ['c3', 'Atrio Restaurante SA de CV', 'José Luis Perez'], ['c4', 'Operadora Feliciana', 'José Luis Perez'], ['c5', 'Cactus Wine', 'Carlos Tapia'], ['c6', 'LIZA STIKER', 'Carlos Tapia'], ['c7', 'Hotel Xcaret', 'Carlos Tapia'], ['c8', 'Vivid Distribución', 'Carlos Tapia'], ['c9', 'Quince Rooftop', 'José Luis Perez'], ['c10', 'Pangea Monterrey', 'Carlos Tapia']];
let id = 0;
for (const [cid, name, v] of cli) for (let m = 0; m < 34; m++) { if (rnd() < 0.45) continue; if (cid === 'c9' && m > 10) continue; if (cid === 'c4' && m < 12) continue;
  const day = m * 30 + Math.floor(rnd() * 28), tot = Math.round((cid <= 'c2' || cid === 'c5' ? 60000 : 12000) * (0.5 + rnd())); id++;
  out.push(`INSERT INTO invoices VALUES (${[`i${id}`, d(day), cid, name, v, tot, pick(['paid', 'sent', 'overdue'])].map(q).join(',')});`);
  out.push(`INSERT INTO orders VALUES (${[`o${id}`, 'SO-' + (1000 + id), d(day + 1), cid, name, v, tot, 'confirmed', pick(['invoiced', 'invoiced', 'not_invoiced']), pick(['paid', 'unpaid'])].map(q).join(',')});`); }
out.push(`INSERT INTO people VALUES ('jl@example.test','José Luis','rep');`);
out.push(`INSERT INTO meta VALUES ('sync_hoja','{"at":"${new Date().toISOString()}","ok":true,"rows":412}');`);
console.log(out.join('\n'));
