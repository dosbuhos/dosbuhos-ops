# Mantenimiento Dos Búhos

Mobile maintenance tracker ("MaintainX light") for Adrián and the team. Cloudflare Worker + D1, no build step.

## Deploy (GitHub → Cloudflare Workers Builds)

1. Copy this folder into the `dosbuhos-ops` repo as `mantenimiento/` and push.
2. Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick `dosbuhos-ops`.
3. Settings:
   - Project name: `dosbuhos-mantenimiento` (must match `name` in wrangler.jsonc)
   - Root directory: `mantenimiento`
   - Build command: *(leave empty)*
   - Deploy command: `npx wrangler deploy`
4. Deploy. URL: `https://dosbuhos-mantenimiento.<your-subdomain>.workers.dev`

The D1 database `mantenimiento` already exists and has its schema applied (ID is in wrangler.jsonc). Every push to the repo redeploys.

## Access (no passwords)
- Más → Usuarios → Agregar usuario (name, WhatsApp, optional email) → **Crear y enviar acceso** → send the link by WhatsApp or copy it.
- The link opens the app and keeps that phone logged in (sessions renew every time the app is opened; 1 year idle).
- Links last 7 days and work up to 5 times (phone browser + home-screen app).
- **Quitar acceso** logs the person out everywhere and kills their links.
- PIN is only a backup (Más → PIN de respaldo, and "Entrar con PIN" on the login screen).

## Email login (optional)
1. Cloudflare → Workers Plans → Workers Paid ($5/mo; required to email arbitrary addresses).
2. Compute → Email Service → Email Sending → Onboard Domain → dosbuhos.com. Check the DMARC record against the existing Google Workspace one before accepting.
3. In `wrangler.jsonc`, uncomment `"send_email": [{ "name": "EMAIL" }]` and push.
Then the login screen offers "Enviarme el acceso" (link + 6-digit code, valid 30 min) and admins get "Enviar por correo".

## Roles
- **Usuario**: create tasks, change status/assignee/date, notes, photos.
- **Administrador**: everything above + delete tasks, manage users and areas.

## Photos
Compressed on the phone (~200 KB) and stored in D1. To move them to R2 later: enable R2 in the dashboard, create bucket `mantenimiento-fotos`, uncomment the `r2_buckets` block in wrangler.jsonc. New photos go to R2; old ones keep working.

## Schema changes
Add a new file in `migrations/` and run `npm run db:remote` (or change the deploy command to `npm run deploy`).

## Local dev
```
npm install
npm run db:local
npm run dev
```
