// Minimal fake of the Stripe endpoints the app reads, for local testing only.
// Usage: node test/mock-stripe.mjs  (listens on 127.0.0.1:8788). Data is fictional.
import http from 'node:http';

const at = (ymd) => Math.floor(Date.parse(ymd + 'T18:00:00Z') / 1000); // local noon in Mexico City
const cust = (id, name, email, extra = {}) => ({ id, object: 'customer', name, email, phone: '+52 415 000 0000', address: { line1: 'Calle Demo 1', city: 'San Miguel de Allende', state: 'GTO', postal_code: '37700', country: 'MX' }, ...extra });
const price = (id, product, amount, interval_count) => ({ id, product, unit_amount: amount, currency: 'mxn', recurring: { interval: 'month', interval_count } });
const sub = (id, customer, p, start, extra = {}) => ({ id, object: 'subscription', customer, status: 'active', start_date: at(start), created: at(start), canceled_at: null, ended_at: null, cancel_at: null, pause_collection: null, items: { data: [{ id: 'si_' + id, price: p }] }, ...extra });

const products = [
  { id: 'prod_bronce', name: 'Círculo Bronce' },
  { id: 'prod_plata', name: 'Círculo Plata' },
  { id: 'prod_diamante', name: 'Círculo Diamante — La Mesa' },
  { id: 'prod_club', name: 'Club de Vinos Dos Búhos' }, // the original club: no keyword → must be mapped by hand
];
const P = {
  bronce: price('price_bronce', 'prod_bronce', 360000, 3),
  plata: price('price_plata', 'prod_plata', 645000, 3),
  diamante: price('price_diamante', 'prod_diamante', 560000, 1),
  club: price('price_club', 'prod_club', 317000, 3),
};
const subscriptions = [
  sub('sub_A', cust('cus_A', 'Valeria Prueba', 'valeria@example.com', { shipping: { name: 'Valeria Prueba', address: { line1: 'Privada Ejemplo 12', city: 'San Miguel de Allende', state: 'GTO', postal_code: '37700', country: 'MX' } } }), P.diamante, '2026-06-15'),
  sub('sub_B', cust('cus_B', 'Mario Ejemplo', 'mario@example.com'), P.bronce, '2026-07-14'),
  sub('sub_C', cust('cus_C', 'Lucía Demo', 'lucia@example.com'), P.club, '2026-02-12'),
  sub('sub_D', cust('cus_D', 'Pedro Cancelado', 'pedro@example.com'), P.bronce, '2026-03-01', { status: 'canceled', canceled_at: at('2026-07-20'), ended_at: at('2026-08-01') }),
  sub('sub_E', cust('cus_E', 'Ana Pausa', 'ana@example.com'), P.bronce, '2026-05-02', { pause_collection: { behavior: 'void', resumes_at: at('2026-12-01') } }),
  sub('sub_F', cust('cus_F', 'Jorge Nuevo', null), P.plata, '2026-10-16'),
  sub('sub_G', cust('cus_G', 'Fallido Inicial', 'x@example.com'), P.bronce, '2026-10-01', { status: 'incomplete_expired' }),
];
const inv = (id, s, periodStart, newShape) => ({
  id, object: 'invoice', status: 'paid', amount_paid: s.items.data[0].price.unit_amount, created: at(periodStart),
  status_transitions: { paid_at: at(periodStart) },
  lines: { data: [{ period: { start: at(periodStart), end: at(periodStart) + 86400 * 28 } }] },
  ...(newShape ? { parent: { type: 'subscription_details', subscription_details: { subscription: s.id } } } : { subscription: s.id }),
});
const invoices = [
  inv('in_A1', subscriptions[0], '2026-06-15', true), inv('in_A2', subscriptions[0], '2026-07-15', true),
  inv('in_A3', subscriptions[0], '2026-08-15', false), inv('in_A4', subscriptions[0], '2026-09-15', true),
  inv('in_B1', subscriptions[1], '2026-07-14', true), inv('in_B2', subscriptions[1], '2026-10-14', true),
  inv('in_C1', subscriptions[2], '2026-02-12', false),
];

const list = (data) => ({ object: 'list', data, has_more: false });
export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Bearer sk_test_local_mock') { res.writeHead(401); return res.end(JSON.stringify({ error: { message: 'bad key' } })); }
  if (!req.headers['stripe-version']) { res.writeHead(400); return res.end(JSON.stringify({ error: { message: 'no version' } })); }
  let body;
  if (url.pathname === '/v1/products') body = list(products);
  else if (url.pathname === '/v1/subscriptions') body = list(subscriptions);
  else if (url.pathname === '/v1/invoices') body = list(invoices);
  else if (url.pathname.startsWith('/v1/customers/')) body = subscriptions.map(s => s.customer).find(c => c.id === url.pathname.split('/')[3]) || null;
  else if (url.pathname.startsWith('/v1/products/')) body = products.find(p => p.id === url.pathname.split('/')[3]) || null;
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body || { error: { message: 'not found' } }));
});
if (process.argv[1] && process.argv[1].endsWith('mock-stripe.mjs')) server.listen(8788, '127.0.0.1', () => console.log('mock stripe on 8788'));
export { subscriptions, at };
