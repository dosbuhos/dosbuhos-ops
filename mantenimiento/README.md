# Mantenimiento Dos Búhos

What is broken, who has it, what is late, and what comes up through the year. Phone first, Spanish, for the whole
team: anyone reports with a photo; Adrián assigns, postpones or hands work to an outside provider; equipment keeps
its service record. Cloudflare Worker + D1, plain JS, no build step.

- Worker `dosbuhos-mantenimiento`, D1 `mantenimiento`, live at https://dosbuhos-mantenimiento.dos-buhos.workers.dev
- Not behind the Hub: it has its own open sign-up. The Hub lists it as a link.

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
| **Pendientes** | Everything open, late first. Tiles filter (Atrasados, Para hoy, Sin asignar). *Filtrar*: whose, area tags, group by date / area / person. Tick the circle → *Hecho* with an optional note, photo and cost |
| **Un pendiente** | Estado, Lo hace (with Llamar / WhatsApp), Fecha, Prioridad, Área, Equipo, Costo: each opens a sheet. *Posponer* asks for the new date and why, and counts how many times it was pushed. Late ones show a banner with *Pasar a otro*. Notes and the automatic history below |
| **Reportar** (+) | Photo, what is wrong, where, how urgent. Without a date: urgent = today, normal = a week, "puede esperar" = none |
| **Preventivo** | *El año*: the twelve months with every scheduled service (hecho / en Pendientes / atrasado / programado); what comes up every month folds into one line. *Planes*: N times a year by tapping months, every N days/weeks/months, or once. A plan puts its job in Pendientes N days before |
| **Equipos** | Photo, make and model, who looks after it, last service, next service, faults in 90 days, history. *Anotar servicio*, *Reportar falla* |
| **Contactos** | Outside providers by trade and the house team, each with call / WhatsApp and what they have open |
| **Cuenta** | Resumen (8-week chart, by person, by area, oldest open), Lo que ya se hizo, Invitar por WhatsApp, Personas and Áreas (administrators) |

Areas are coloured tags (the 12 colour names Horizonte uses), set in Cuenta → Áreas.
WhatsApp is by link (`wa.me`) with the pendiente's details filled in; nothing is sent automatically.

## Files

- `src/worker.js` — the API (`/api/*`). `src/plan.js` — when a plan comes up next and the phone rule (unit-tested).
- `public/core.js` (shared pieces), `public/app.js` (entering, Pendientes, one pendiente, reporting),
  `public/more.js` (Preventivo, Equipos, Contactos, Cuenta, router), `public/app.css`.
- Colours and fonts come from the Hub's shared theme (`hub/THEME.md`); every token has a local fallback.
- `migrations/` — D1 schema. 0001–0006 are applied to the remote database. The tables `login_links` and `purchases`
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
