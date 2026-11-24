# Pulso (reservaciones/)

The reservations and sales app, at pulso.dosbuhos.com and apps.dosbuhos.com/reservaciones/ (Hub sign-in). Named Pulso on 23 Nov 2026 (it was "Reservaciones"); it has no "‹ Hub" link.

The week's reservations as a manifest, with the guest behind each one, and Parrot's sales beside them. Phone first,
Spanish UI. Worker `reservaciones`, behind the Hub at `apps.dosbuhos.com/reservaciones/` (short address: `manifest.dosbuhos.com`). No build step.

- **Reservaciones**: ‹ semana › stepper, days stacked. On the current week a **Hoy** panel (covers, expected, arrived,
  past their time and unmarked, next arrival, arrivals by half hour with a "now" line) and **Pendientes** (confirm
  today/tomorrow, no-show history, no table, tables of 6+, prepayments with no reservation, past days left open in
  OpenTable). The week strip splits covers into served, confirmed and to confirm. A row is status rail, hour, party,
  guest, tags (table, prepaid, nth visit, earlier no-shows, channel); it opens a sheet with call / WhatsApp / email,
  lead time, the visit timeline, the prepayment (with card country) and history. Repeat guests match on email or
  phone among the guests kept here. Each day carries its Parrot numbers side by side, never joined to a reservation.
- Look: Archivo (self-hosted, OFL), wine-dark bar, owl-eye logo; installable (`manifest.webmanifest`, icons).
- **Ventas** (Hub roles editor and admin): ‹ › by day, week or month. Net sales, guests, tickets and tips against the
  previous period and the same weekdays a year earlier; sales by day, by hour, by line of business, top products,
  payments by type, twelve weeks of trend. Every chart has its table.

## Where the data comes from

Nothing is synced twice. The Growth Terminal already keeps everything in its D1 database `growth`; this app reads it
(binding `GROWTH`, SELECT only) and writes only its own small database:

| Data | Table (database) | Kept fresh by |
|---|---|---|
| OpenTable reservations (through Klaviyo) | `ot_reservations` (growth) | growth, every 30 min |
| Parrot checks, items, payments | `pos_orders`, `pos_items`, `pos_payments` (growth) | growth, every 15 min |
| Old point of sale, daily totals to Aug 2026 | `pos_daily_history` (growth) | loaded once |
| Stripe prepayments of OpenTable experiences | `stripe_payments` (growth) | growth, every 15 min |
| Guest name, phone, email per reservation | `guests` (reservaciones) | this app, every 15 min |

**Guests.** Growth Terminal deliberately holds no guest identities. This app gets them from Klaviyo through the growth
Worker's `KlaviyoGuests` entrypoint (binding `GUESTS`; growth holds the key and hands over only the confirmation number,
the reserved time and the booker's name, email and phone). `src/huespedes.js` reads what is new on the cron, and at most
every three minutes when the manifest finds a reservation without a guest. A guest is deleted 90 days after the visit
(`RETENCION_DIAS`); the data stays in OpenTable and Klaviyo. Everyone the Hub lets in sees names and contact details.

## What the screen is honest about

- Missing data reads "sin dato", never 0. A day with no checks that was being recorded is a real zero ("sin servicio").
- Walk-ins are not in the feed: the manifest is reservations only.
- OpenTable was connected to Klaviyo on 2026-11-22 (`FEED_DESDE`). A reservation booked before that for a later date is
  absent until OpenTable sends another event for it, so for 60 days the days ahead carry a notice.
- Tour or restaurant is not in the feed. Prepaid experiences are **estimated** from Stripe (`src/experiencias.js`): a
  prepayment belongs to the only reservation at its hour, or to the one whose party size fits the amount at the usual
  price per person; otherwise it is listed on its own under the day. Always labelled "estimación".
- Sales definitions are Growth Terminal's (`growth/src/read/sales.ts`): net is finished checks without IVA after
  discounts; guests are customers on dine-in checks, trusted from 2026-11-04; a year earlier is 364 days back, without
  the "Eventos" category. Lines of business come from Parrot's item categories (`lineaDe` in `src/ventas.js`).

## Routes

| Route | What |
|---|---|
| `GET /api/semana?d=YYYY-MM-DD` | The week that day falls in (Monday to Sunday): days, reservations, guests, estimates, day sales for those who may see them |
| `GET /api/ventas?p=dia\|semana\|mes&d=YYYY-MM-DD` | Sales of that period. 403 for the Hub role viewer |
| `POST /api/sincronizar` | Read guests from Klaviyo now (admins) |
| anything else | Static files in `public/` (no data in them) |

The API answers only requests signed by the Hub (`X-DB-User` + signature, `src/hub-auth.js`), with `cache-control: no-store`.
Roles: Hub role **viewer** sees the manifest with guests; **editor** and **admin** (and Hub admins, and `ADMIN_EMAILS`)
also see sales.

## Bindings

- `DB`: D1 `reservaciones` (migrations in `migrations/`; apply to the remote database and record in `d1_migrations`).
- `GROWTH`: D1 `growth`, read-only use. Its migrations stay in `growth/`.
- `GUESTS`: service binding to `growth`, entrypoint `KlaviyoGuests`. The growth Worker has to be deployed first.
- `HUB_SESSION_SECRET`: account Secrets Store. Cron: every 15 minutes.
- Secrets: none.

## Local

```
npm install
printf 'ENVIRONMENT=dev\nDEV_USER=you@example.com\nDEV_ROLE=admin\n' > .dev.vars   # or DEV_ROLE=viewer for a host
npm run dev        # loads made-up data into the local databases (scripts/seed-local.mjs), then wrangler dev
npm test           # node --test; the growth schema comes from ../growth/migrations
```

In local dev `?hoy=2026-11-21` before the `#` pretends it is that day. The guest read needs the growth Worker, so
locally it reports that it is missing; the seed provides made-up guests instead.

## Guest Center import

The Klaviyo feed misses bookings OpenTable never passes on (mostly phone and in-house), future bookings made before
22 Nov 2026, and walk-ins. `scripts/importar-guestcenter.mjs` takes Guest Center's reservations export (Reporting →
Reservations, all statuses, with the Created / Canceled / No-show / Seated / Finished / Last Updated columns) and the
current rows (`FILAS_SQL` in the script), matches them by visit date and creation minute, and writes SQL with the
sync's own upsert. Missing rows get a stable `gc-` id; walk-ins are stored with origin `walk-in` and shown here only as
a per-day count. When the feed later brings a `gc-` reservation under its real number, the sync deletes the copy
(growth `klaviyo-reservations.ts`). A daily scheduled task runs the export and the import at 05:47.

