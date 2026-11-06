# Staging changelog

Newest night first. Each entry: time, what changed and why, files, screenshots (`review/<date>/`).

## Preguntas para Eric
- **Mapa del cuarto girado en el teléfono?** At 390px the room map is ~20px per metre, so a barrel is ~14px and the
  section rows are 16–19px tall. Tonight's bigger tap areas help (26–37px), but the real fix would be drawing the room
  rotated 90° on phones (south at the top, west wall on the right): it would be ~2.5× bigger and fill the screen
  width. It changes how the room "looks" to the crew, so I didn't do it. Prototype it next run? (yes / no)
- **"rellenar +5 d" under each barrel**: on the phone the line under the barrel is the most useful one (late or not) but
  long. OK to shorten it to just **"+5 d"** in the ring's colour on phones, with the legend explaining it? Or keep the word?
- **Chip "Tinto" en la tarjeta** (e.g. on a rosé or the Orange Moscato): it shows the barrel's *Tipo* (what the barrel is
  used for), not the wine. Rename the chip on the card to **"Barrica de tinto"** (and "Tipo" in Datos to **"Uso de la
  barrica"**)? Or is Tipo meant to follow the wine? I left it as is.
- **Bottom nav in English** ("Wines", "Protocols", "Agregar" is already Spanish): tonight only the app-bar title changed
  ("WINES" → "BODEGA"). OK to make the nav Spanish too on Night 2 ("Bodega", "Protocolos")?
- **SO₂ colours differ**: the barrel card calls 12.4 ppm yellow (goal 20, low < 12), Lista shows it green (low < 10). Which
  thresholds are right? I'll make them match once you say.

## 2026-11-06 · Night 1 — Barricas on the phone

### Resumen de la noche (mira esto primero)
All on staging, phone first (390px). Open **Bodega → Barricas** on your phone; screenshots are on `/staging-review.html`.
1. **Mapa del cuarto** — tap a section with a thumb: each one has a bigger tap area and the chosen one is outlined in green. (Mapa, top.)
2. **Vista de frente** — the lines under each barrel (wine, "rellenar +N d", SO₂) are readable now. (Tap any wall section.)
3. **Tarjeta de barrica** — the banner says *when* topping was due ("15 d tarde — tocaba el 22 oct"); SO₂ and Relleno are
   two calm tiles; buttons, tabs and × are glove-size; Notas no longer zooms on iPhone. (Tap a full barrel, e.g. 044.)
4. **Lista** — the state tabs aren't covered any more, rows line up, the right column says "SO₂ 12.4" / "📍 9.3";
   Ordenar is inside **Filtros**. (Barricas → Lista.)
5. **Editar pasillo** — on the phone the aisle wraps into rows of 3 with big "+" / "×" and a one-line hint. (Mapa → an
   aisle (Pasillo este/oeste) → Editar pasillo.)
6. Small: app bar says **BODEGA** instead of WINES; Vinos/Tanques/Barricas/Embotellado all fit; Mapa/Lista buttons 38px.

Open questions: see **Preguntas para Eric** above (map rotated on phones, "+5 d" wording, "Tinto" chip, Spanish nav,
SO₂ thresholds) — no new ones from run 3.

### Run 1 (≈23:00 Central) — audit
Before screenshots: `review/2026-11-06/*-before.png` (390×844 and 1300×900, mock data).
Biggest phone problems, worst first:
- **Room map is too small to hit.** Each section (a wall run, an aisle row) is a 16–19px strip on a 390px screen, the
  column numbers are ~6px, and the green "TÚ" marker sits on top of the gap between sections and swallows taps. With gloves
  you hit the wrong section or nothing.
- **Front view text is ~5px.** The wall is scaled to ~63% to fit 6 columns, so the wine line and "rellenar +N d" under
  each barrel come out at ~5px — unreadable at arm's length. The barrel number (~11px) is OK.
- **Chrome before the first barrel**: app bar + Vinos/Tanques/Barricas/Embotellado + Mapa/Lista + "Registrando como"
  ≈ 215px (25% of the screen) before the map; "Embotellado" is cut off at the right edge; Mapa/Lista buttons are 28px tall.
- **Lista**: the status tabs (Todas / Con vino / Vacías…) run under the "Tipo de vino" select and "Vacías" is cut; the
  wine dot and the status line don't line up; the right column (last SO₂ / place) has no label.
- **Barrel card**: the SO₂ tile packs 5 lines of 11px red text; "Toca rellenar · 15 d tarde" and the Relleno tile say the
  same thing twice; the header shows "Llena" and "Tinto" as two chips for a rosé ("Rosado Cab Franc" → "Tinto").
- App bar says **"WINES"** (English) while you're in Barricas.

### Run 1 — changes
- **Room map: bigger tap areas, clear selected section.** Each section of the map now has an invisible tap area around
  it (up to ~9px on each side, never more than half the gap to its neighbour, so two sections never overlap); the
  selected one shows it as a light green box with a green outline. The "TÚ" marker no longer blocks taps. Column numbers
  on phones are ~20% bigger. Tap rows went from 16–19px to 26–37px tall. Desktop gets the same outline.
  Files: `cellar/app/barricas.html` (`mmHits()` after `minimap()`, CSS block "staging night 1"). Screens: `02-phone-room-map`, `07-desktop-room`.
- **Front view: readable lines under the barrels on phones.** Wine line and "rellenar +N d" use the narrow Barlow
  Condensed face at a larger size (≈8px on screen instead of ≈5px), SO₂ number and barrel number a bit bigger. CSS only,
  ≤600px only. Screen: `03-phone-front-view`.
- **Compact Bodega chrome on phones.** Vinos/Tanques/Barricas/Embotellado now all fit (Embotellado was cut), tighter gaps,
  and Mapa/Lista buttons are 38px tall instead of 28px. The map starts 12px higher. Files: `cellar/app/mobile.css`
  (block at the end). Screens: `01-phone-chrome-mapa`, `04-phone-lista` (unchanged, checked), `06-desktop-mapa` (unchanged).
- Risk: low; CSS plus one display-only function. Checked: no horizontal scroll at 390, Mover flow still picks sections
  on the map, desktop unchanged apart from the outline. Mock fonts were loaded locally so screenshots match the real fonts.

### Run 2 (≈01:00 Central) — barrel card, Lista
Checked run 1 at 390×844 first: map tap areas, front-view text and the compact chrome all hold; no horizontal scroll;
desktop unchanged. Nothing to fix from run 1. Found one old bug on the way: empty barrels showed "vacía" in red in the SO₂ tile (fixed below).
- **Barrel card: banner says when it's due, tiles stop repeating it.** The red/yellow banner now reads "Toca rellenar ·
  15 d tarde — tocaba el 22 oct 26" (or "Relleno al día — el próximo toca el …") instead of repeating the last date that the
  Relleno tile already shows; the tile keeps "hace 45 d / 22 sep 26 / llenada …". SO₂ tile: shorter lines
  ("10 nov 25 · hace 361 d", "+7.8 g KMBS · 10 nov 25", "meta 20 ppm" in grey); only what's late is red, not every line.
  On phones there are two wide tiles instead of three narrow ones; the barrel's age and "tostado ?" move to the line under
  the card (they repeated "hecha en 2019"). Desktop keeps three tiles with the same calmer text.
  Files: `cellar/app/barricas.html` (`panel()` template, CSS block "staging night 1 run 2"). Screens: `08-phone-barrel-card-top`, `10-desktop-barrel-card`.
- **Barrel card: glove-size controls, no iOS zoom.** "+" on the tiles 26→36px (≈46px hit area), × close 31→44px, the wine
  name picker has a 44px hit area, tabs (Datos / Mantenimiento / Historial / Etiqueta) 36→44px, Notas textarea 15→16px
  (iOS zoomed in on it), checkboxes 13→22px in Mantenimiento, dates in Registros no longer break over two lines.
  Phones only. Screen: `09-phone-barrel-card-mant`.
- **Lista on phones: tabs not covered, rows line up, numbers labelled.** The "Ordenar" select covered "Vacías"; on phones the
  sort is now in **Filtros → Ordenar por** (same options; desktop keeps the select). Every row has the same right column,
  so the wine names and "Toca · hace N d" line up row to row; the right column says **"SO₂ 12.4"** and **"📍 9.3"** (no reading
  → nothing instead of "—"); long wine names wrap instead of being cut; 22px checkboxes; the wine dot sits on the name line
  (desktop too). Files: `cellar/app/cellar-room.js` (sort buttons in the Filtros sheet + their click; SO₂ / 📍 labels),
  `cellar/app/cellar-room.css` (block at the end). Screens: `11-phone-lista`, `12-desktop-lista`, `13-phone-lista-filtros`,
  `14-phone-lista-bulk` (the "after" is sorted by Número because the test used the new sort buttons).
- **App bar "WINES" → "BODEGA"** on phones (`cellar/app/mobile.js`, one word). Screen: `11-phone-lista`.
- Checked, not changed: **Mover** at 390px — the dark bar ("Moviendo 010 · … Toca un lugar vacío (verde)") is readable,
  buttons are 44px, Cancelar is always there. Left for the next run with Poner barrica / Editar pasillo.
- Risk: low. Display only, plus one JS change in Lista (sort buttons in the Filtros sheet write the same `C.sortB` the
  select writes). `node --check` on the touched scripts; no horizontal scroll at 390; desktop card and Lista checked.

### Run 3 (≈05:00 Central) — re-test, Editar pasillo
Re-tested everything changed tonight on the mock at 390×844 and 1300×900: room map, front view, barrel card and its four
tabs, ánfora card, Mover (pick a spot → Confirmar / Cambiar / Cancelar), Poner una barrica aquí, Editar pasillo, Lista,
Filtros sheet, bulk bar. No regressions and no horizontal scroll. (Barrel 035 shows "¿vino?" on the card while the front
view says '25 SB: same on `main` — it's a "Por confirmar" barrel in the mock data, not something tonight changed.)
- **Mover / Poner barrica: checked, left as is.** The dark bar is readable, says what to tap ("Toca un lugar vacío
  (verde)"), the chosen spot turns solid green, and Confirmar / Cambiar / Cancelar are 44px, full width, always at the bottom.
- **Editar pasillo on phones: big "+" and "×", rows of 3, a hint.** One aisle row was scaled to ~52% on a phone, so the
  "+" that adds a spot was ~12px and the "×" that removes an empty added spot ~8px — not tappable with gloves. While
  editing on a phone the aisle now wraps into rows of 3 with wider gaps: each "+" has a ≈51×72px tap area, the "×" is
  ~25px with a larger ring, barrels ~46px. Under the section name: "Toca + para agregar un lugar. × quita un lugar vacío
  que agregaste. Toca Listo al terminar." Same insert points and saves as before (tested: + adds a spot, × removes it).
  Desktop keeps the single row (gets the hint too). Files: `cellar/app/barricas.html` (`drawAisle()`, the Editar pasillo
  button code in `draw()`, CSS block "staging night 1 run 3"). Screens: `15-phone-editar-pasillo`, `16-desktop-editar-pasillo`,
  `17-phone-editar-pasillo-lugar-after` (a spot just added, with its ×).
- Not done tonight (left for Night 2): Spanish/terms/colour consistency pass, and empty/loading/error states.
- Risk: low. Display only; the aisle order and spot ids are written exactly as before. `node --check` on the page script.

