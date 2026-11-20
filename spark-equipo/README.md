# Spark Equipo

Los números del equipo de ventas en el teléfono: ritmo semanal de contactos, seguimientos, ventas del mes, clientes año contra año, zonas y prospectos, y efectividad. Es el "Tablero de ventas" llevado al Hub (`/spark/`).

Cada vendedor ve solo lo suyo. Eric y los administradores del Hub ven a todos, la pantalla de Efectividad y Ajustes.

## How it works
- `src/sheets.js` copies the three "Actividad" tabs of the CRM Google Sheet into D1 once a day (06:00 San Miguel).
- `src/zoho.js` copies Zoho Inventory sales orders and invoices three times a day. The first runs walk the whole history, 10 pages per run; the "Sincronizar ahora" button in Ajustes runs one more step.
- `src/calc.js` turns those rows into every figure on screen. Pure functions, covered by `test/calc.test.js`. The page (`public/app.js`) only lays the figures out.
- `src/ai.js` asks Claude for a suggested next step per account, from the rep's last notes (table `sugerencias`). It runs after each sync, 40 accounts at a time, and only rewrites a suggestion when the notes or the follow-up state change. Claude writes words only; every number comes from `calc.js`.
- Activity rows carry `origen`: `hoja` rows are replaced on every sheet sync; `app` rows (logged in Spark, next phase) are kept.

## Routes
| Route | Who | What |
|---|---|---|
| `GET /api/data` | signed in | The view model, filtered to the person |
| `POST /api/admin/sync[?solo=hoja\|zoho\|ia]` | admin | Run a sync now |
| `GET/POST /api/admin/people` | admin | Link a Hub email to a person or make it an admin |

Without `HUB_SECRET` every `/api` route answers 401, so the workers.dev address shows nothing.

## Bindings
- `DB`: D1 `spark-equipo` (activity, orders, invoices, alias, people, meta)
- `ASSETS`: `public/`
- `ANTHROPIC_API_KEY`: account Secrets Store (model in var `AI_MODEL`, default `claude-sonnet-5-5`)
- `SHEETS`: service binding to `cellar` (entrypoint `SheetsRead`), which holds the Google service-account key; the CRM sheet must be shared with that account's email (shown in Ajustes) and listed in cellar's `SHEETS_READ_IDS`
- `ZOHO`: service binding to `dosbuhos-ops` (entrypoint `ZohoRead`), which holds the Zoho secrets; its token must be able to read sales orders and invoices
- Cron: 12:00, 18:00, 00:00 UTC

## Secrets
- None for the Hub: the session secret comes from `HUB_SESSION_SECRET` in the account Secrets Store (binding in `wrangler.jsonc`)

## Local
```
npm install
printf 'ENVIRONMENT=dev\nDEV_USER=you@dosbuhos.com\n' > .dev.vars   # DEV_ADMIN=0 to see it as a rep listed in people
npx wrangler d1 migrations apply spark-equipo --local
node scripts/seed.mjs > /tmp/seed.sql && npx wrangler d1 execute spark-equipo --local --file /tmp/seed.sql   # made-up rows
npm run dev
npm test
```

## Config kept in the repo
- `src/data/zonas.json`: the nine zones, their market weight and which Zoho client belongs to which zone
- `src/data/prospectos.json`: prospect list with sources
- `src/data/alias.json`: first load of the Zoho ↔ CRM name table (then it lives in D1 `alias`)
- `HEREDADAS` and `DIST_DANIEL` in `src/calc.js`: inherited accounts and Daniel's distributors
