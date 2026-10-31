# Hub — Dos Búhos command center

One Google sign-in, one place to open every Dos Búhos app, one admin for who gets what. Cloudflare Worker `hub` + D1 `hub`,
no build step. Scope: https://claude.ai/artifact/J8sWyuAjcF942KVg2KcoiD

| Path | What |
|---|---|
| `/` | Launcher: the apps this person can open, grouped by section (Bodega, Huerta, Hospitalidad, Ventas, Marketing, Equipo, Administración). Hub admins see every app, including the *Próximamente* placeholders |
| `/admin/` | People and access, the app registry, the audit log (Hub admins only) |
| `/<slug>/…` | An app served through the Hub (registry `mode = proxy`): the request goes to that app's Worker over a service binding with a signed `X-DB-User` header |
| `/auth/google`, `/auth/callback`, `/auth/salir` | Sign-in and sign-out |
| `/api/…` | JSON for the pages above (`src/api.js`) |
| `/kit/kit.css` | The shared UI kit (palette, type, cards, chips, tables, trend tiles). Apps behind the Hub can link it |

## Deploy (GitHub → Cloudflare Workers Builds, like the other apps)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → `dosbuhos-ops`.
2. Project name `hub` (must match `name` in wrangler.jsonc), root directory `hub`, build command empty, deploy command `npm run deploy`.
3. Deploy. URL: `https://hub.dos-buhos.workers.dev`. Every push to `main` that touches `hub/` redeploys; `npm run deploy` applies new migrations first.

## One-time setup

1. Secrets on the `hub` Worker (dashboard → hub → Settings → Variables and Secrets):
   - `GOOGLE_CLIENT_SECRET` — same value as on the `cellar` Worker (OAuth client "Cellar calendar", project dos-buhos)
   - `SESSION_SECRET` — any long random string
   - `HUB_ADMIN_EMAILS` — comma-separated Google accounts that are Hub admins from their first sign-in
2. Google Cloud → that OAuth client → add redirect URI `https://hub.dos-buhos.workers.dev/auth/callback` (later also `https://apps.dosbuhos.com/auth/callback`).
3. Sign in. Admin → People: add each person by Gmail and pick their apps and roles. Nobody not on the list can sign in.

Emails stay out of this repo (it is public): people live in D1, admins in the secret.

## Custom domain

Once dosbuhos.com's DNS is on Cloudflare: uncomment `routes` in `wrangler.jsonc`, push, add the second redirect URI above.

## Putting an app behind the Hub

1. Copy `lib/hub-auth.js` into the app; call `hubUser(request, env)` instead of its own login. Set secret `HUB_SECRET` on the app = the Hub's `SESSION_SECRET` so the header signature is checked.
2. Make the app work under a prefix: `withPrefix(request)` gives `/cellar`; use it in front of absolute links and `fetch()` paths.
3. In the Hub's `wrangler.jsonc` the binding already exists (CELLAR, HUERTO, MANTENIMIENTO, SPARK, WINECLUB, OPS); in Admin → Apps set the app's mode to `proxy`.
4. When it works, set `"workers_dev": false` on the app so the Hub is the only way in.

Roles: Hub admins are admins in every app. Everyone else gets `admin`, `editor` or `viewer` per app; the app decides what each role may do.

## Local dev

```
npm install
printf 'SESSION_SECRET=dev\nHUB_ADMIN_EMAILS=you@example.com\nGOOGLE_CLIENT_SECRET=x\n' > .dev.vars
npm run db:local && npm run dev
```
Google sign-in needs a real redirect URI, so for local work insert a `users` row and a `sessions` row with `wrangler d1 execute hub --local` and set the `hub_session` cookie to `<session id>|<expiry seconds>|<HMAC>` (see `src/auth.js`).
