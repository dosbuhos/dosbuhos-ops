# Overnight refinement on staging — brief for each run

You are improving the Dos Búhos **Cellar & Production Tracker** (`cellar/` in github.com/dosbuhos/dosbuhos-ops) on a
**staging copy**, overnight, while Eric (owner) sleeps. In the morning he reviews what you did and decides what goes to
production. Goal: on a phone, this becomes the best cellar app there is — fast, obvious, calm, built for a cellar crew
(Paris, Jimena, Eduvijes, Margaro, Jaime; Spanish speakers, gloves on, bad light, one hand).

## Hard rules (never break these)
1. **Work only on the `staging` branch.** Never commit to, merge into, or push `main`. Never deploy production.
   Staging is a **read-only preview of the real app**: Cloudflare Workers Builds publishes every push to `staging` at
   `https://staging-cellar.dos-buhos.workers.dev` (real data, every save refused — see the `preview` guard at the top of
   `cellar/src/index.js`). Nothing else to deploy. (The separate `cellar-staging` worker env is unused.)
2. **No writes to real data or outside systems.** Don't run SQL against the production D1 (`b1bae952…`), don't call
   Google Sheets / Excellovint, don't send messages or emails. Test with the local mock (below) only.
3. **Never create, change or delete cellar work orders or plan items**, not even in text — propose them in the review.
4. **Don't delete data or remove features.** On UX nights (1–2), don't add features or change the data model/APIs;
   change how things look, read and flow. If a fix needs a feature, write it up as a proposal instead.
5. Crew-facing text is **Spanish**; write "free run" in English, never "yema". Keep the voice short and plain.
6. Every change must be reversible and small enough to review: one idea per commit, clear message, ending with
   the attribution lines from your session's instructions.
7. Secrets live in Cloudflare; never print, copy or add keys/tokens.

## Where things are
- `cellar/app/` sources → `python3 cellar/app/build.py` writes `cellar/public/` (always rebuild before testing/committing).
  - `cellar-targets.html` main app (Vineyard/Winery views, work orders, wines, labs…)
  - `cellar-room.js/.css` Bodega → Barricas / Tanques (Mapa and Lista tabs)
  - `barricas.html` the barrel room page (map, front views, barrel/ánfora cards). It is the **source** now — edit it directly.
  - `mobile.css/js` phone layer.
- `cellar/src/` worker (API, auth). Avoid changing it on UX nights.
- `cellar/staging/mock/server.cjs` local mock: `PORT=8788 node cellar/staging/mock/server.cjs` serves `cellar/public` with
  sample data (`ROLE=crew` to act as the crew account). Playwright + Chromium are preinstalled
  (`NODE_PATH=$(npm root -g) node your-test.cjs`). Pages: `/index.html#barricas`, `/barricas.html`, `/barricas.html?b=44`.
  The mock returns empty lists for most other APIs, so work-order screens look empty locally: read their code and test
  with injected sample rows where needed.

## Each run
1. `git fetch origin && git checkout staging && git merge --no-edit origin/main` (keep staging current with production).
2. Read `cellar/staging/PLAN.md` (tonight's night and its checklist) and `cellar/staging/CHANGELOG.md` (what earlier runs did).
3. Take **screenshots first** (iPhone-size 390×844 and a 1300×900 desktop) of the screens you'll touch — that's the "before".
4. Pick the 1–3 most valuable unchecked items for tonight. Think like a senior product designer *and* a cellar hand:
   what does someone with wet gloves need to see first? What makes them hesitate? Cut, merge, enlarge, clarify.
5. Implement, rebuild, test on the mock at 390px (tap targets ≥ 44px, no horizontal scroll, no overlap, readable at arm's length).
   Check you didn't break desktop. `node --check` the scripts you touched.
6. "After" screenshots into `cellar/staging/review/<YYYY-MM-DD>/` (`NN-short-name-before.png` / `-after.png`, deviceScaleFactor 1).
7. Append to `CHANGELOG.md`: date/time, what changed, why (one or two lines each), files, screenshots, anything risky.
   Tick items in `PLAN.md`; add new findings to its backlog.
8. `python3 cellar/staging/build_review.py` (regenerates `cellar/public/staging-review.html`), rebuild, commit, `git push origin staging`.
9. If something needs Eric's decision, add it under **Preguntas para Eric** in `CHANGELOG.md` instead of guessing.

The last run of the night (around 5am Central) also writes a short **Resumen de la noche** at the top of that night's
CHANGELOG section: the 3–6 changes worth looking at first, with the screen to open.
