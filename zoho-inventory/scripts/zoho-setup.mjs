// Connects the app to Zoho Inventory (read-only) and stores the keys as Worker secrets.
// Run on your own computer:  npm run zoho
// Nothing is printed or sent anywhere except to Zoho and to your Cloudflare Worker.
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('\n1. Go to https://api-console.zoho.com → Add Client → Self Client.');
console.log('2. In the Self Client, "Generate Code" with this scope (10 minutes):');
console.log('   ZohoInventory.salesorders.READ,ZohoInventory.items.READ\n');
const id = (await rl.question('Client ID: ')).trim();
const secret = (await rl.question('Client Secret: ')).trim();
const code = (await rl.question('Generated code: ')).trim();
const accounts = (await rl.question('Zoho accounts URL [https://accounts.zoho.com]: ')).trim() || 'https://accounts.zoho.com';
rl.close();

const u = new URL(accounts + '/oauth/v2/token');
for (const [k, v] of Object.entries({ grant_type: 'authorization_code', client_id: id, client_secret: secret, code })) u.searchParams.set(k, v);
const r = await fetch(u, { method: 'POST' });
const j = await r.json();
if (!j.refresh_token) { console.error('\nZoho did not return a refresh token:', j.error || j); process.exit(1); }

for (const [name, value] of [['ZOHO_CLIENT_ID', id], ['ZOHO_CLIENT_SECRET', secret], ['ZOHO_REFRESH_TOKEN', j.refresh_token]]) {
  const p = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  if (p.status !== 0) { console.error('Could not save ' + name); process.exit(1); }
}
console.log('\nDone. Zoho is connected. Open the app → Admin → "Importar de Zoho ahora".');
