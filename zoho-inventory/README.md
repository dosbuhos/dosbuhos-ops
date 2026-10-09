# zoho-inventory · Muestras app

Sample-bottle tracking for the sales reps: imports $0.00/$0.01 sales orders from Zoho Inventory, reps close each event from their phone (bottles, photos, results), and admins see what each rep should be holding. Cloudflare Worker + D1 + R2.

## Setup

The database (D1 `muestras`) already exists in your Cloudflare account, with the tables created and Carlos added as a rep.
Four steps are left. None of them needs you to share a password or key with anyone.

### 1. Turn on R2 (photo storage)
Cloudflare dashboard → **R2 Object Storage** → enable it (free up to 10 GB; it may ask for a card).
Then **Create bucket** → name: `muestras-fotos`.

### 2. Deploy the app (once)
Cloudflare dashboard → Workers & Pages → Create → **Import a repository** → `dosbuhos/dosbuhos-ops`.
- Root directory: `zoho-inventory`
- Build command: leave empty · Deploy command: `npx wrangler deploy`

Every push to `main` that touches this folder redeploys it. The dashboard shows the app's address,
like `https://dosbuhos-ops.<your-subdomain>.workers.dev`. Everyone sees "Sin acceso" until step 3.

### 3. Turn on logins (Cloudflare Access)
Dashboard → Workers & Pages → **dosbuhos-ops** → Settings → Domains & Routes → workers.dev → **Enable Cloudflare Access**.
- Edit the access policy so it allows these emails: `emaycotte@gmail.com`, `carlostapia@dosbuhos.com` (login by one-time code to their email).
- Copy the **team domain** (`xxxx.cloudflareaccess.com`) and the **AUD tag** shown there.
- Put them in `wrangler.toml` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) and push. They aren't secret, so you can send them to Claude to do it.

### 4. Connect Zoho (read-only)
In the same PowerShell window:

    npm run zoho

It walks you through creating a Zoho "Self Client", asks for the client ID, secret and a one-time code, and saves them
directly as Worker secrets. Run it from a local copy of this folder (`npm install` first), then open the app → **Admin** → **Importar de Zoho ahora**.
After that it imports every night at 2:15 am.

## Who sees what
- **Admins** (`ADMIN_EMAILS` in wrangler.toml): everything, approve or return reports and counts, manage reps.
- **Reps** (added in Admin → Vendedores, by email): only their own bottles, events and counts.
  A new rep also has to be added to the Access policy in step 3.

## What gets imported
Every Zoho sales order on the rep's sample contact(s), from the "Importar desde" date (Carlos: 10 Jul 2026), lines at $0.00 or $0.01 only.
- Orders that say the product goes into his CDMX inventory → added to his stock, no report needed.
- "Bodega CDMX" orders → an event using bottles he already holds.
- Everything else → a new event he must close within 3 days (overdue after 7).
