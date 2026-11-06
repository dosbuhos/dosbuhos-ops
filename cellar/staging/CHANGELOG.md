# Staging changelog

Newest night first. Each entry: time, what changed and why, files, screenshots (`review/<date>/`).

## Preguntas para Eric
- **Mapa del cuarto girado en el teléfono?** At 390px the room map is ~20px per metre, so a barrel is ~14px and the
  section rows are 16–19px tall. Tonight's bigger tap areas help (26–37px), but the real fix would be drawing the room
  rotated 90° on phones (south at the top, west wall on the right): it would be ~2.5× bigger and fill the screen
  width. It changes how the room "looks" to the crew, so I didn't do it. Prototype it next run? (yes / no)
- **"rellenar +5 d" under each barrel**: on the phone the line under the barrel is the most useful one (late or not) but
  long. OK to shorten it to just **"+5 d"** in the ring's colour on phones, with the legend explaining it? Or keep the word?

## 2026-11-06 · Night 1 — Barricas on the phone

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
