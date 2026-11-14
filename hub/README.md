# Hub — Dos Búhos command center

One Google sign-in, one place to open every Dos Búhos app, one admin for who gets what. Cloudflare Worker `hub` + D1 `hub`,
no build step. Scope: https://claude.ai/artifact/J8sWyuAjcF942KVg2KcoiD

| Path | What |
|---|---|
| `/` | Launcher: the apps this person can open, grouped by section (Bodega, Huerta, Hospitalidad, Ventas, Marketing, Equipo, Administración). Hub admins see every app, including the *Próximamente* placeholders |
| `/admin/` | People and access, the app registry, the audit log (Hub admins only) |
| `/ads/` | **Anuncios**: Google + Meta spend, bookings, ROAS, alerts, campaigns, monthly pace and the ads to-do list. Lives inside the Hub (`src/ads.js`, `public/ads.html`, tables `ads_*`); access = a grant on the `ads` app. See [Anuncios](#anuncios) |
| `/biblioteca/` | **Biblioteca**: the document library (policies, contracts, SOPs, forms, proposals) with numbered versions and files per version. See [Biblioteca](#biblioteca) |
| `/<slug>/…` | An app served through the Hub (registry `mode = proxy`): the request goes to that app's Worker over a service binding with a signed `X-DB-User` header |
| `/auth/google`, `/auth/callback`, `/auth/salir` | Sign-in and sign-out |
| `/api/…` | JSON for the pages above (`src/api.js`) |
| `/kit/kit.css` | The shared UI kit (palette, type, rows, chips, role picker, tables, trend tiles). Apps behind the Hub can link it |
| `/theme.css`, `/theme.json`, `/theme/logo-*` | The shared theme set in Admin → Diseño (public, CORS). How apps adopt it: [THEME.md](THEME.md) |
| `/kit/demo.html` | Every kit component with the markup to copy (no sign-in needed) |

## Deploy (GitHub → Cloudflare Workers Builds, like the other apps)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → `dosbuhos-ops`.
2. Project name `hub` (must match `name` in wrangler.jsonc), root directory `hub`, build command empty, deploy command `npx wrangler deploy`.
3. Deploy. URL: `https://hub.dos-buhos.workers.dev`. Every push to `main` that touches `hub/` redeploys. Database migrations are not applied by the build: run `npm run db:remote` (or apply the new file in `migrations/` from Claude) before pushing code that needs them. 0001–0010 are applied.

## One-time setup

1. Secrets on the `hub` Worker (dashboard → hub → Settings → Variables and Secrets):
   - `GOOGLE_CLIENT_SECRET` — same value as on the `cellar` Worker (OAuth client "Cellar calendar", project dos-buhos)
   - `SESSION_SECRET` — any long random string
   - `HUB_ADMIN_EMAILS` — comma-separated Google accounts that are Hub admins from their first sign-in
2. Google Cloud → that OAuth client → add redirect URI `https://hub.dos-buhos.workers.dev/auth/callback` (later also `https://apps.dosbuhos.com/auth/callback`).
3. Sign in. Admin → People: add each person by Gmail and pick their apps and roles. Nobody not on the list can sign in.

Emails stay out of this repo (it is public): people live in D1, admins in the HUB_ADMIN_EMAILS secret.

## Custom domain

Once dosbuhos.com's DNS is on Cloudflare: uncomment `routes` in `wrangler.jsonc`, push, add the second redirect URI above.

## Putting an app behind the Hub

1. Copy `lib/hub-auth.js` into the app; call `hubUser(request, env)` instead of its own login. Set secret `HUB_SECRET` on the app = the Hub's `SESSION_SECRET` so the header signature is checked.
2. Make the app work under a prefix: `withPrefix(request)` gives `/cellar`; use it in front of absolute links and `fetch()` paths.
3. In the Hub's `wrangler.jsonc` the binding already exists (CELLAR, HUERTO, MANTENIMIENTO, SPARK, WINECLUB, OPS, COTIZADOR); in Admin → Apps set the app's mode to `proxy`.
4. When it works, set `"workers_dev": false` on the app so the Hub is the only way in.

Roles: Hub admins are admins in every app. Everyone else gets `admin`, `editor` or `viewer` per app; the app decides what each role may do.

## Local dev

```
npm install
printf 'SESSION_SECRET=dev\nHUB_ADMIN_EMAILS=you@example.com\nGOOGLE_CLIENT_SECRET=x\n' > .dev.vars
npm run db:local && npm run dev
```
Google sign-in needs a real redirect URI, so for local work insert a `users` row and a `sessions` row with `wrangler d1 execute hub --local` and set the `hub_session` cookie to `<session id>|<expiry seconds>|<HMAC>` (see `src/auth.js`).

## Anuncios

Google and Meta ads in one page at `/ads/` (registry slug `ads`, mode `internal`). Viewers read; editors also tick and
add pendientes; admins also set the monthly budget and targets.

- **Google**: `scripts/google-ads-feed.js` runs hourly inside Google Ads (today included) and POSTs the last 90 days + campaign state to
  `/ads/api/ingest` with a bearer token. A Hub admin makes the token with `POST /ads/api/token` (only its SHA-256 is
  stored, in `ads_config`); paste it into the script in Google Ads, never into this repo.
- **Meta**: the Hub's hourly cron (`triggers.crons`, `src/ads-meta.js`) reads the Marketing API with a system-user token a
  Hub admin pastes in Anuncios → Conexiones (kept in `ads_config`, never returned to the page). Daily rows in USD are
  stored in MXN at the day's rate (`spend_native`, `fx` keep the original); the hand-loaded weekly rows give way to them.
- **Bookings** (`ads_bookings`): OpenTable / Rezdy by source, once OpenTable takes online bookings.
- Money is MXN everywhere. Windows end on the last day Google has data, so a late feed shows as "hasta el …" plus an
  alert instead of a run of zeros.

## Club de beneficios

Who gets which benefits, their card, and what staff apply. Scope: [CLUB-SCOPE.md](CLUB-SCOPE.md). Code: `src/club-core.js`
(rules, no I/O), `src/club-data.js`, `src/club.js` (staff/admin API), `src/club-public.js` (guest pages),
`src/club-wineclub.js` (Círculo sync), `src/qr.js` (server-side QR SVG), `public/club.html`. Tables `club_*` (migration 0004).

- `/club/` (registry slug `club`, Hospitalidad): grant role **admin** = club admin (programs × benefits grid, invitations,
  Novios, moves between programs, approvals); **editor/viewer** = staff (Hoy, scan/search, register visits, receipts,
  card resends, Resumen). Staff never edit programs. Every change goes to `club_audit` with the Hub user's email.
- `/c/<code>`: the guest card, no sign-in. The code is a 144-bit random token and the only credential (noindex,
  no-referrer, private cache + service worker for offline). Signed-in staff with a club grant are sent to the staff view
  (`?invitado=1` shows the guest view). `/c/i/<token>` sign-up, `/c/` lost card (neutral answer), `/c/terminos`.
- Levels by purchases (Nivel 1/2/3, thresholds editable) come from rolling-12-month spend: registered visits (check −
  discount), approved receipts and Círculo subscription charges. Per benefit the best value across a person's programs
  applies; no stacking.
- Wine club: binding `WINECLUB_DB` (database `wineclub-production`, read-only use). The hourly cron and Programas →
  "Sincronizar ahora" copy live subscribers (matched by email or phone; merged members skipped), their paid charges of
  the last 12 months (amount missing → subscription price, flagged "estimado") and founders (→ Fundadores).
- Socios (`#socios`, replaces Buscar): search, scan, and the whole member database with filters (Activos, Por vencer =
  next 30 days, Vencidos, Por aprobar, Bloqueados), program, sort and paging; admins also get **Agregar socio** (`#nuevo`,
  no invitation needed) and **Exportar CSV** (`/club/api/members.csv`, audited; never includes card links).
- Vigencia (migration 0005): a program can last N months (`duration_months`, 0 = no expiry), have a fee (`fee_mxn`) and a
  payment link (`pay_url`, e.g. Stripe). New memberships get the program's duration (wine club ones follow Stripe and
  don't expire here). An expired membership stops applying the next day: the door view and the card say so, the card
  shows "Renovar" with the payment link. Renewing (ficha → Programas or the banner) counts from the expiry if still
  running, else from today, and can record the fee in one step.
- Pagos (`club_payments`): fees by method (efectivo, transferencia, tarjeta, Stripe, otro), optionally renewing; voided,
  never deleted. Fees don't count toward purchase levels. Resumen shows fees in 12 months, expiring in 30 days, lapsed.
- Preguntas del registro (Programas → Preguntas, `club_fields`): text, choice, yes/no or date; for one program or all;
  required (guest sign-up only; staff adding someone are never blocked) or "solo equipo" (never shown to the guest).
  Answers in the ficha (Datos) and the CSV.
- Mis datos (guest card): add or change email, birthday and answers. Saved values are never shown back on the card (the
  link is the only credential); blank keeps what's there. Name and WhatsApp changes go through staff.
- Wallet cards (`src/club-wallet.js`): "Agregar a Apple Wallet" / "Guardar en Google Wallet" on the card page
  (`/c/<code>/wallet/apple` → signed `.pkpass`; `/c/<code>/wallet/google` → Google's save page). Same QR as the web card,
  so staff scan it the same way. Name, program and level on the front; Apple's back lists the benefits as of when it was
  added; the live list stays on the web card. Each button appears only once its settings exist:
  - Apple: Apple Developer account in the company's name (US$99/yr; needs a D-U-N-S number) → Certificates →
    Pass Type ID `pass.com.dosbuhos.club` → create its certificate, export certificate + key as PEM (key unencrypted
    PKCS#8), and download Apple's WWDR G4 intermediate. Vars `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`; secrets
    `APPLE_PASS_CERT`, `APPLE_PASS_KEY`, `APPLE_WWDR_CERT`.
  - Google: Google Pay & Wallet Console → Google Wallet API → issuer account (approval for production use); a
    service account in the `dos-buhos` Cloud project with access to the issuer, JSON key. Var `GOOGLE_WALLET_ISSUER_ID`;
    secrets `GOOGLE_WALLET_SA_EMAIL`, `GOOGLE_WALLET_SA_KEY` (the key's `private_key`).
  - Not yet: pushing changes to cards already in a wallet (Apple web service / Google object updates). A level change
    shows on the web card at once; the wallet copy updates when the member adds it again.
  - `test/club-wallet.test.mjs` signs with throwaway certificates and checks the `.pkpass` with openssl.
- Parrot and OpenTable: no integration yet; staff type the check number and total, and copy the OpenTable note.
- Deploy: apply `migrations/0004_club.sql` (`npm run db:remote`) before pushing. It also removes the "Club de lealtad"
  placeholder app. Optional var `PUBLIC_ORIGIN` sets the host used in card and invite links (defaults to the request's).

## Biblioteca

Document library at `/biblioteca/` (registry slug `biblioteca`, section Administración, mode `internal`). Code:
`src/biblioteca.js`, `public/biblioteca.html`, tables `lib_*` (migration 0006). Viewers read and download; editors add
documents, versions and files; admins also archive and delete. Every change goes to the audit log.

- A document (`lib_docs`) has a category, status (borrador / vigente / archivado), audience, tags and an optional link.
- Each version (`lib_versions`, "1.0", "1.1"…) has a note and any number of files (`lib_files`), e.g. the PDF to send and
  the Word to edit. The newest version is the current one; older ones stay downloadable.
- Files are stored in D1 as BLOB chunks of 900 KB (`lib_chunks`), max 25 MB per file, served at `/biblioteca/f/<id>`.
  A file is complete when `lib_files.chunks` equals its number of chunks; uploads set it last.
- **Filing from Claude** (no Hub sign-in needed, through the Cloudflare D1 API): insert a `lib_docs` row (or reuse one),
  a `lib_versions` row with `created_by = 'claude'`, a `lib_files` row with `chunks = 0`, then the chunks as
  `X'<hex>'` literals (keep each statement under ~90 KB of hex), then set `chunks` to the count. Bump `lib_docs.updated_at`.
