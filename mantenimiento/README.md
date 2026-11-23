# Pulso (Mantenimiento Dos Búhos)

What is broken, who has it, what is late, and what comes up through the year. Phone first, Spanish, for the whole
team: anyone reports with a photo; Adrián assigns, postpones or hands work to an outside provider; equipment keeps
its service record. Cloudflare Worker + D1, plain JS, no build step.

- The app is called **Pulso** and lives at https://pulso.dosbuhos.com (a custom domain on this Worker, declared in
  `wrangler.jsonc`). The folder, the Worker (`dosbuhos-mantenimiento`) and the D1 database (`mantenimiento`) keep their
  names; https://dosbuhos-mantenimiento.dos-buhos.workers.dev keeps working. Sessions are per address, so someone who
  signed in on one signs in once more on the other.
- Not behind the Hub: it has its own open sign-up. The Hub lists it as a link: its tile is the `apps` row with slug
  `mantenimiento` in the Hub database, renamed there to Pulso and pointed at https://pulso.dosbuhos.com (a data change
  made with the D1 tool on 23 Nov 2026; nothing in `hub/` changed).

## Access: open sign-up (Eric, Nov 2026)

No PIN, no links, no approval. A person opens the address, types **name + WhatsApp (+ email, optional)** once per
phone and is in; the session lasts a year and renews on every visit.

- The last 10 digits of the phone identify the person (`users.phone_key`), so `415 123 4567`, `+52 415…` and
  `521415…` are the same account. Typing a registered phone signs that person back in.
- An administrator with an email on file also has to type it (they can delete things and remove people). There is
  no code or password: knowing someone's phone is enough to enter as them, which is the trade-off of having no gates.
- Everyone can report, assign, set priority and dates, postpone, add notes and photos, add equipment, contacts and
  plans. Only administrators delete, manage people and edit the areas.
- Cuenta → Personas: close or reopen sign-up (`settings.signup_open`), make someone an administrator, remove access.
- Safety nets: 40 sign-ups a day at most, `noindex` everywhere, `robots.txt` disallows all.
- A person who signs up gets a card in Contactos (or takes over the card someone already made with their phone), so
  work can be assigned to them.

## Screens

| Tab | What |
|---|---|
| **Pendientes** | Everything open, grouped by priority (Urgente, Alta, Normal, Baja) with the late ones first in each group. Tiles filter (Atrasados, Para hoy, Sin asignar). *Filtrar*: whose, priority, area tags, group by priority / date / area / person. Tick the circle → *Hecho* with an optional note, photo and cost |
| **Un pendiente** | Estado, Lo hace (with Llamar / WhatsApp), Fecha, Prioridad, Área, Equipo, Costo: each opens a sheet. *Posponer* asks for the new date and why, and counts how many times it was pushed. Late ones show a banner with *Pasar a otro*. Notes and the automatic history below |
| **Semana** | The week planner, modelled on Horizonte. On a phone: the week as one column of days; hold a pendiente for a moment (here or in any list) and a day slides in: drop it on an hour, on *Ese día, sin hora* or on *Quitar la fecha*, and take the finger to the left or right edge to change the day. On a wide screen (mouse): Left: what still needs a day, by priority. Right: Monday to Sunday, 6:00 to 20:00. Drag a pendiente onto a day and hour to plan it (an hour long until its lower edge is pulled), drag it to move it, drop it on *Sin hora* for a day without a time, drop it back on the list to take the date away. Pick one person to see their week; unassigned work dropped there becomes theirs. Each day shows the hours planned. The day is the pendiente's `due_date`; `plan_min` is the time of day and `est_min` how long it takes (also the *Tiempo* row of a pendiente). Moving a date here before its day comes is planning, so it is not counted as *pospuesto* |
| **Reportar** (the floating + on a phone, the button at the top of the side bar on a computer) | Photo, what is wrong, where, how urgent. Without a date: urgent = today, normal = a week, "puede esperar" = none |
| **Preventivo** | *El año*: the twelve months with every scheduled service (hecho / en Pendientes / atrasado / programado); what comes up every month folds into one line. From July on the page continues into the next year, so about a year ahead is always in view. *Planes*: N times a year by tapping months, every N days/weeks/months, or once. A plan puts its job in Pendientes N days before |
| **Equipos** | Photo, make and model, who looks after it, last service, next service, faults in 90 days, history. *Anotar servicio*, *Reportar falla* |
| **Contactos** | Outside providers by trade and the house team, each with call / WhatsApp and what they have open |
| **Cuenta** | Resumen (8-week chart, by person, by area, oldest open), Lo que ya se hizo, Invitar por WhatsApp, Personas and Áreas (administrators) |

Areas are coloured tags (the 12 colour names Horizonte uses), set in Cuenta → Áreas.
WhatsApp is by link (`wa.me`) with the pendiente's details filled in; nothing is sent automatically.

## Files

- `src/worker.js` — the API (`/api/*`). `src/plan.js` — when a plan comes up next and the phone rule (unit-tested).
- `public/core.js` (shared pieces), `public/app.js` (entering, Pendientes, one pendiente, reporting),
  `public/week.js` (the week planner), `public/more.js` (Preventivo, Equipos, Contactos, Cuenta, router), `public/app.css`.
- The look is the app's own (`public/app.css`), in the same family as Horizonte: ink on white, Geist (self-hosted in
  `public/fonts/`), flat lists ruled with hairlines. Colour is kept for state (red late, amber today or waiting, green
  done) and the area tags. It does not load the Hub's theme, so the Hub's presets do not restyle it.
- `migrations/` — D1 schema. 0001–0007 are applied to the remote database. The tables `login_links` and `purchases`
  are left from the PIN / link version and are not used.

## Deploy

Push to `main`; Workers Builds deploys this folder (root directory `mantenimiento`, deploy command
`npx wrangler deploy`). A schema change is a new file in `migrations/`, applied to the remote database (from Claude
through the D1 tool, or `npm run db:remote`) **before** the code that needs it is pushed, and recorded in
`d1_migrations`. Bump `?v=` in `public/index.html` when the scripts or the stylesheet change.

Bindings: `DB` (D1), `ASSETS`; optional `PHOTOS` (R2). Secrets: none. Cron `0 12 * * *` (06:00 San Miguel) creates
the preventive jobs that are due; they are also created whenever someone opens the app.

Photos are shrunk on the phone to about 250 KB plus a 10 KB preview and stored in D1 (`photos.data`, `photos.thumb`).

## Tests

```
npm test                      # plan dates and the phone rule (node:test)
npm run db:local && npm run dev -- --port 8787
python3 test/seed.py          # made-up people and jobs in the local database (needs: requests, Pillow)
python3 test/e2e.py           # every main flow through the phone UI (needs: playwright for Python, Chrome)
python3 test/shots.py /tmp/shots 390 light   # a screenshot of every screen + overflow and tap-target checks
```
`e2e.py` and `shots.py` expect a freshly seeded database (`rm -rf .wrangler/state`, `npm run db:local`, seed).
The audit for any visual change: `shots.py` at 360, 390 and 430 px, light and dark, and 1280 for the desktop layout.

## Not built yet

- Automatic notifications (WhatsApp Business API or web push). Phones are collected at sign-up for this.
- Working with no signal (reports are kept on screen and can be resent, not queued).
- QR tags on equipment that open its page.
