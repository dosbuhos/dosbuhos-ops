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
Mi trabajo: Hoy, Semanas y meses, Seguimiento, Preguntas pendientes. Ventas: Ventas del mes (with the 2026 budget), Cobranza, Clientes. Cuentas: Directorio, Copeo y embudo, Encuestas, Zonas y prospectos. Recursos: Estrategia y promociones (strategy documents, goals, the year's budget against actual, and promotions with the offer in one line, the full terms, who authorized them and when, and the original document attached (stored in D1 table `archivos`, served at `/api/archivo/<id>` behind sign-in, up to 1.5 MB); each row is admin-only or visible to the team), Materiales de venta, Comunicaciones (coming). Dirección (admins): Efectividad, Ajustes. `public/app.js` holds the shell and the first group; `public/mas.js` the account-side screens.

Plan and events (`public/plan.js`): **Plan** is the 90-day plan, commitments with an owner (a rep, Ily, Dirección or Contabilidad), a due date and how each is measured (D1 `compromisos`). Rows start as drafts only the Hub admin sees; he publishes them, and each owner marks theirs done with a note (`POST /api/plan/hecho`; `POST /api/admin/plan` to add, change, publish or remove, Hub admin only). Overdue ones show under Urgente on Inicio. **Eventos** is the request, approval and close-out of events (D1 `eventos`): asked for with cost, bottles and expected sales in 60 days (`POST /api/eventos`), approved by an admin up to `EVENTO_TOPE` and by the Hub admin above it (`POST /api/admin/eventos`), and closed with contacts, bottles used and sales so the return can be compared. KPIs also show the month's punctuality (contacts logged within 48 hours, the number that adjusts commission) and service moments (trainings, tastings, client visits to the winery, gifts). A promotion with `metas` (JSON targets per account) shows each account's progress under Estrategia.

## What people can write
- A contact (`POST /api/actividad`): stored in `activity` with `origen = 'app'`, never touched by the sheet sync. Tapping an account in Seguimiento (or in Clientes principales) opens this form with the account and its last note; `fecha` lets a rep back-date a contact they had not logged. `pausa` (`si`/`no`) marks or clears "shipments on hold for collections" on the account (`cuentas.pausa`, migration 0006); the account still counts as due for a contact.
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

## The house account and whose sale it is
- `Tito` (`CASA` in `src/calc.js`) is the shared house account for sales and prospecting Eric and Diane do themselves. It logs contacts and owns orders like a rep, has no contact goal or rating, and is left out of the team totals. It is the fourth person chip; an admin with no rep identity logs contacts as Tito by default.
- `asignaciones` (migration 0007) credits one order (`tipo = 'orden'`, by order number) or a whole account (`tipo = 'cuenta'`) to someone other than the salesperson on the Zoho order. Applied in `modelo()` before the calculations; Zoho is not changed. Admins set it with "Reasignar" in Semanas y meses → Qué vendieron (`POST /api/admin/asignar`). A carved-out house order leaves the client with its rep and is listed as a house client for that amount.

## Distributor scouting
- Kept in the "Distribuidores" tab of the CRM sheet (one row per distributor: plaza, zone, type, status, contact, what happened, next step, last and next contact, rejection reason, line of interest, owner). `syncSheet` copies it into the `distribuidores` table (migration 0008) on every sheet sync; an empty or missing tab leaves the last copy. Until the first copy, `src/data/prospeccion_carlos.json` (Carlos's file of 21 Nov 2026, the tab's starting content) is used.
- `build()` merges the list into the prospects of Zonas y prospectos (matched to the researched list by zone and name, the rest added), counts worked prospects per zone, and adds open distributors to their owner's Seguimiento when the CRM has no contact for them (`de_archivo`; they do not count as logged contacts). The newer of the tab's date and a contact logged in Spark wins.
- Screen: Cuentas → Distribuidores. Status changes and new distributors go in the sheet tab; contacts can be logged from the screen.

## Sales goals
- `src/data/presupuesto.json`: monthly goals per rep for the year (file "AJUSTE DE METAS", Aug–Dec are the adjusted goals; exports count for no rep). Ventas del mes shows the month, the year to date against the goal to date (current month by days elapsed), the whole year, and month by month.
- La Competencia Imports (`DE_ERIC`) counts as a house sale under Tito and is left out of the Mexican zones.
- Goals are before IEPS and IVA. Zoho's order list only gives totals with taxes, so sales compared against goals are `total / 1.4674` (IEPS 26.5% then IVA 16%), an estimate that is exact for wine-only orders.

## New accounts
- `POST /api/cuenta/nueva` creates a prospect that is not a Zoho client yet (name, type, zone, and a phone or an email; duplicate names are refused). Stored in `cuentas` with `origen = 'app'`, `zona` and `vendedor` (migration 0009). It shows in the Directorio and joins the prospects of its zone.
- In the contact form the account field searches every known account; the first choice is always "Nueva cuenta", which opens the new-account fields in the same form. Directorio and Distribuidores also have a button for it.

## Receivables
- `orders.saldo` (migration 0010) is Zoho's `balance` on each sales order. Cobranza lists invoiced orders with a balance, due 30 days after the order date (the invoice's own due date needs invoice access). Until orders have been re-read after this change, the dated copy of Carlos's file (`src/data/cobranza.json`) is shown; its comments stay attached by client.

## Materiales de venta, Dónde nos venden y Premios

- **Materiales de venta** (`#materiales`): documents from the `materiales` table shown as cards with a first-page preview
  (`public/mat/<file name>.webp`, made with `pdftoppm`; files without a preview get a plain tile), a bottle gallery, and
  **Dónde nos venden** (distributors, restaurants, hotels and shops by country, searchable, with a copy-list button).
- **Premios** (`#premios`): medals and scores by wine or by competition, with a copy button per wine.
- Awards and the where-sold list live in `public/marca.js`, generated from the QR card (`card/build_app.py`) so both say
  the same thing. After changing `AWARDS` or `WHERE` there, run `python3 tools/marca_desde_tarjeta.py` from this folder.

## Inicio y Buzón

- **Inicio** (`#hoy`, the default): per person, sales for the month and the year against the goal to date, contacts for the
  week, month and year, and up to five urgent items (open questions, late logging, follow-ups more than 14 days overdue,
  clients past their reorder date, balances over 90 days). On phones the team view is one compact card per person.
- **Buzón** (`#buzon`): Eric's questions, the "por atender" and "va bien" notes, and promotions in force. "Hecho" hides a
  note for that user (`buzon_hechos`, `POST /api/buzon/hecho`). `#pendientes` still opens Buzón.

## Navegación

Seis lugares, los mismos en el menú del escritorio y en la barra inferior del celular: **Inicio, Cuentas, Prospectos, Ventas, Plan y Recursos**.
Cada lugar agrupa sus pantallas como pestañas bajo el título (`SECC` en `public/app.js`). El **Buzón** es la campana de arriba, **Ajustes** el engrane,
y **＋ Registrar** abre las tres altas: contacto con una cuenta, cliente o prospecto nuevo, y evento.
Spark usa sus propios neutros (blanco frío y pizarra, menú oscuro); del tema del Hub solo toma el color de acento.
