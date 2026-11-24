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

## Without signal
The garden has little signal, so Pulso works offline (`public/sw.js` + `public/offline.js`).
- **Reading.** The service worker keeps the app on the phone, and the last answer to every GET (network first; after 6 s
  with no answer, the kept copy, marked `x-pulso-offline`). Photos are kept once seen, and the photos of open pendientes are
  fetched in the background so they are there in the garden. A line at the bottom says *Sin señal* while what is shown came
  from the phone.
- **Writing.** A report, a change to a pendiente, a note or a pendiente's photo made with no signal goes to an outbox in
  IndexedDB and the screen carries on as if it had gone out (marked *Por enviar*). The outbox is laid over what the server
  last said and goes out in order on `online`, on reopening the app and every 30 s. A pendiente reported offline has a
  negative id until the server numbers it; what was done to it meanwhile follows with the real number. Anything else
  (contacts, equipment, plans, Personas) still needs signal and says so.
- **Version.** `V` and the file list in `sw.js` must match the `?v=` in `index.html` (`test/shell.test.mjs` checks).
  Tests: `python3 test/offline.py` (the service worker is not registered on 127.0.0.1 unless the page is opened with `?sw`).

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

Pulso is laid out the way Horizonte is (Eric, 23 Nov 2026): the calendar first, lists you plan from, no side menu.

**On a phone.** A ribbon of views along the bottom (Bandeja, Atrasados, Día, Semana, Todo) and a floating **+** to
report. The top row of every main screen is menu · title · the phone icon (Contactos).

**On a wide screen.** One bar along the top: show/hide the lists, Pulso, Día | Semana, ‹ Hoy ›, whose calendar,
Contactos, Reportar, the account. Under it the lists on the left and the hours on the right. Everything that is not
the planner (Equipos, Preventivo, a pendiente's page, Cuenta) opens as a page under the same bar.

| View | What |
|---|---|
| **Día** (the app opens here) | Today's hours, 6:00 to 20:00. Phone: the strip of the week on top (tap a day, slide for another week), then what the day has without an hour (folds into one line), then the blocks; slide sideways for the next day. Wide: two days side by side, each with its *Sin hora* row |
| **Semana** | Phone: the seven days in one column, each with its pendientes and a + to report something for that day. Wide: seven columns of hours |
| **Mes** | A Monday-to-Sunday calendar. Each day shows its open pendientes (a bar each on a phone, their names on a wide screen) and the preventive visits still to come, dashed, before they are pendientes. Phone: the days that have something are listed under the calendar; a day opens in Día. Wide: drop a pendiente on a day to move it there (it keeps its hour) |
| **Bandeja** | The inbox: what has no day yet, by priority, with how long ago it was reported. Every new report lands here, urgent included: nothing gets a day unless the person reporting picks one. While something urgent waits here the Bandeja's count is red |
| **Atrasados** | What passed its day without being done, by the day it was for |
| **Todo** | Everything open, by priority |
| **Every list** | As in Horizonte's panel: search; a line to type a pendiente and press Enter (in the Bandeja, an area or a priority: it lands there with no day); *Filtrar y ordenar*: order by priority, oldest or newest (by the day it was reported), date, area, who does it, who reported it, shortest first, and show only whose / priority / area. The choice follows from list to list and shows as chips; the counts in the menu stay whole |
| **The lists on a wide screen** | The panel on the left: Bandeja, Atrasados, Esta semana, Todo; one list per priority; Tableros (Equipos, Preventivo); Lo que ya se hizo, Resumen. A list opens in the panel and its cards are dragged onto the calendar |
| **Menu** (the grid icon, phones) | Tableros (Equipos, Preventivo), one list per priority, Contactos, Lo que ya se hizo, Resumen, Mi cuenta |
| **A pendiente's sheet** | Tapping a pendiente anywhere opens it over the screen you are on: *Cuándo* (Hoy, Mañana, Otro día, Sin día), hour and how long, priority, *Lo hace* (anyone from the house or a contact, with Llamar / WhatsApp), *Hecho*, and *Ver todo* for its page |
| **Contactos** (the phone icon) | A sheet with every contact, search by name or trade, Llamar / WhatsApp on each row |
| **A pendiente's page** | Estado, Lo hace, Fecha, Tiempo, Prioridad, Área, Equipo, Costo, photos, notes and the automatic history. *Posponer* asks for the new date and why, and counts how many times it was pushed |
| **Reportar** | Photo, what is wrong, where, how urgent. *¿Dónde?* is a drop-down of the areas; its last option, *Otro lugar*, opens a line to write a place that is not on the list. That text stays with the pendiente (`tasks.place`) and shows where the area would; it does not join the list unless an administrator adds it from the pendiente (*¿Dónde?* → *Agregar a la lista*). A pendiente has an area or a written place, never both |
| **Preventivo** | *El año*: the twelve months with every scheduled service (hecho / ya en el calendario / atrasado / programado); what comes up every month folds into one line. From July on the page continues into the next year. *Planes*: N times a year by tapping months, every N days/weeks/months, or once. A plan puts its job on the calendar N days before |
| **Equipos** | Photo, make and model, who looks after it, last service, next service, faults in 90 days, history. *Anotar servicio*, *Reportar falla* |
| **Cuenta** | Resumen (8-week chart, by person, by area, oldest open), Lo que ya se hizo, Invitar por WhatsApp, Personas and Áreas (administrators) |

Planning. The day of a pendiente is its `due_date`; `plan_min` is the hour (minutes after midnight) and `est_min`
how long it takes. With a mouse: drag a card from a list or the calendar onto a day and an hour (an hour long until
its lower edge is pulled), onto *Sin hora* for a day without an hour, or back onto the lists to send it to the
Bandeja. By touch: hold a pendiente for a moment and a day slides in; drop it on an hour, on *Ese día, sin hora* or
on *A la Bandeja*. Take the finger to an edge and, after half a second, the day turns like a page: the one on screen
slides out and the next slides in under the pendiente being held (no slide with reduced motion). With one person's calendar chosen, unassigned
work dropped into it becomes theirs. Moving a day before it comes is planning and is not counted as *pospuesto*.
Whatever is done leaves the calendar (it is in *Lo que ya se hizo* and in the equipment's history).

Areas are coloured tags (the 12 colour names Horizonte uses), set in Cuenta → Áreas.
WhatsApp is by link (`wa.me`) with the pendiente's details filled in; nothing is sent automatically.

## Files

- `src/worker.js` — the API (`/api/*`). `src/plan.js` — when a plan comes up next and the phone rule (unit-tested).
- `public/core.js` (shared pieces and the shell: ribbon, top bar, sheets), `public/app.js` (entering, what can be done
  to a pendiente, its page, reporting), `public/planner.js` (Día, Semana, the lists, the card, the sheets of a
  pendiente and of Contactos, dragging), `public/more.js` (Preventivo, Equipos, Contactos, Cuenta, router), `public/app.css`.
- The look is the app's own (`public/app.css`) and follows Horizonte's: the same shell, ink on white, Geist
  (self-hosted in `public/fonts/`), flat lists ruled with hairlines on a phone, boxed cards in the columns of a wide screen. Colour is kept for state (red late, amber today or waiting, green
  done) and the area tags. It does not load the Hub's theme, so the Hub's presets do not restyle it.
- Lists by area: under the priorities, *Áreas* opens (and stays as it was left) to show each area with its open pendientes; an area is a list like any other, by priority (`#/area/N`, `#/area/0` for what has none). On a phone it is in the menu.
- `migrations/` — D1 schema. 0001–0008 are applied to the remote database. The tables `login_links` and `purchases`
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
python3 test/e2e.py           # every main flow through the UI, phone and wide (needs: playwright for Python, Chrome)
python3 test/shots.py /tmp/shots 390 light   # a screenshot of every screen + overflow and tap-target checks
```
`e2e.py` and `shots.py` expect a freshly seeded database (`rm -rf .wrangler/state`, `npm run db:local`, seed).
The audit for any visual change: `shots.py` at 360, 390 and 430 px, light and dark, and 1280 for the desktop layout.

## Not built yet

- Automatic notifications (WhatsApp Business API or web push). Phones are collected at sign-up for this.
- Working with no signal (reports are kept on screen and can be resent, not queued).
- QR tags on equipment that open its page.
