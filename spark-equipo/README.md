# Spark Equipo

Los números del equipo de ventas en el teléfono: ritmo semanal de contactos, seguimientos, ventas del mes, clientes año contra año, zonas y prospectos, y efectividad. Es el "Tablero de ventas" llevado al Hub (`/spark/`).

Todos ven los números del equipo y cada quien abre en los suyos. Efectividad y Ajustes son solo para Eric y los administradores.

## How it works
- `src/sheets.js` copies the three "Actividad" tabs of the CRM Google Sheet into D1 once a day (06:00 San Miguel).
- `src/zoho.js` copies Zoho Inventory sales orders and invoices three times a day. The first runs walk the whole history, 10 pages per run; the "Sincronizar ahora" button in Ajustes runs one more step.
- `src/calc.js` turns those rows into every figure on screen. Pure functions, covered by `test/calc.test.js`. The page (`public/app.js`) only lays the figures out.
- `src/ai.js` asks Claude for a suggested next step per account, from the rep's last notes (table `sugerencias`). It runs after each sync, 40 accounts at a time, and only rewrites a suggestion when the notes or the follow-up state change. Claude writes words only; every number comes from `calc.js`.
- Activity rows carry `origen`: `hoja` rows are replaced on every sheet sync; `app` rows (logged in Spark, next phase) are kept.

## Screens
Mi trabajo: Hoy, Semanas y meses, Seguimiento, Preguntas pendientes. Ventas: Ventas del mes (with the 2026 budget), Cobranza, Clientes. Cuentas: Directorio, Copeo y embudo, Encuestas, Zonas y prospectos. Recursos: Estrategia y promociones (strategy documents, goals, the year's budget against actual, and promotions with who authorized them and when; each row is admin-only or visible to the team), Materiales de venta, Comunicaciones (coming). Dirección (admins): Efectividad, Ajustes. `public/app.js` holds the shell and the first group; `public/mas.js` the account-side screens.

## What people can write
- A contact (`POST /api/actividad`): stored in `activity` with `origen = 'app'`, never touched by the sheet sync.
- The time a contact took (`POST /api/tiempo`), account details, copeo and stage (`POST /api/cuenta`), a collection follow-up (`POST /api/cobros`), a survey link (`POST /api/encuestas`).
- The client answers a survey on `/e/<token>`, a public page on the Worker's own address (no Hub sign-in). The token is 128 random bits.

## Data that is a dated import, not a live feed
- `src/data/cobranza.json`: receivables from Carlos's file (13 Nov 2026). Live receivables need Zoho invoice access.
- `src/data/presupuesto.json`: the 2026 monthly budget per seller, from the same file.
- `src/data/prospeccion_carlos.json`: Carlos's distributor prospecting list.
- `src/data/usa.json`: US accounts and distributor shipments from La Competencia's 2026 annual report.

## Routes
| Route | Who | What |
|---|---|---|
| `GET /api/data` | signed in | The view model for the whole team (Efectividad only for admins) |
| `POST /api/admin/sync[?solo=hoja\|zoho\|ia]` | admin | Run a sync now |
| `POST /api/preguntas/responder` | the person asked, or an admin | Answer an open question |
| `POST /api/admin/preguntas` | admin | Ask, reopen or remove a question |
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
- `esInterno` and `DE_ERIC` in `src/calc.js`: house and sample accounts (nobody's sales) and Eric's own accounts (La Competencia Imports), reported apart
