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

## First run
Open the URL → it asks you to create the first admin (name + PIN). Then **Más → Agregar usuario** for each person (Adrián as Administrador), and **Responsables → + Nuevo** for Adrián, the carpenters and external providers.

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
