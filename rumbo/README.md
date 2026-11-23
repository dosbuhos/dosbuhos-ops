# Rumbo

The F&B director's guide (Michael): what he is working on, how each initiative is going, and his wins. Built on the Spark Equipo shell.

- **Inicio**: overall score, what needs this week's check-in, club sign-ups (read from the wine club database), recent wins.
- **Iniciativas**: his deck. Each has a stage (Idea, Planeación, En marcha, Resultado, Pausada, Cerrada), a dated next step, milestones, numbers and weekly check-ins. At most `TOPE_ACTIVAS` in Planeación or En marcha.
- **Ideas**: a library of F&B plays to make or save money (`src/data/biblioteca.json`). Adopting one copies its milestones and numbers into the deck. An admin who is not the director suggests instead (lands as an idea).
- **Logros**: wins, with a stage (Propuesta, En marcha, Resultado), optional link and photo. No number needed.
- **Mi rol**: the job in one page (`src/data/rol.json`).

Score per initiative, 0–100 (`src/score.js`, tests in `test/`): Ritmo 30, Avance 30, Resultado 40. The overall score is the average.

## Routes
- `GET /api/estado` — everything the app paints.
- `POST /api/iniciativas`, `PATCH|DELETE /api/iniciativas/:id`, `POST /api/iniciativas/:id/(pasos|medidas|registros)`
- `PATCH|DELETE /api/pasos/:id`, `PATCH|DELETE /api/medidas/:id`, `DELETE /api/registros/:id`
- `POST /api/logros`, `PATCH|DELETE /api/logros/:id`, `GET /api/archivos/:id`
- `POST /api/comentarios`, `DELETE /api/comentarios/:id`

## Who can do what
Served behind the Hub at `/rumbo/` (signed `X-DB-User`). `DIRECTOR_EMAILS` and admins (`ADMIN_EMAILS`, Hub admins) can write; anyone else with a Hub grant reads and comments.

## Bindings
- `DB` → D1 `rumbo`. `CLUB` → D1 `wineclub-production`, read-only (`src/club.js` only SELECTs).
- `HUB_SESSION_SECRET` from the account Secrets Store. No other secrets.

## Local
`.dev.vars`: `ENVIRONMENT=dev`, `DEV_USER=michael@dosbuhos.com`, `DEV_ADMIN=0`. Then `npx wrangler d1 migrations apply rumbo --local` and `npm run dev`.
