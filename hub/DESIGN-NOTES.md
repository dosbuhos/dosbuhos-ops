# Hub design notes

Running notes for the design passes. Rules come from `DESIGN-RESEARCH.md`.

## Pass 1 — launcher (Oct 30 2026)

**Job of the page:** get a person into the app they need in one tap, on a phone, outdoors.

**Colour.** The Cellar Target Calendar palette, unchanged so the apps feel like one family: paper `#fffefb` on stone `#f4f3ef`, ink `#1f2426`, bordeaux `#6b2737` as the only accent for actions. Seven section hues (bodega wine, huerta green, hospitalidad ochre, ventas blue, marketing violet, equipo teal, admin grey) appear only as a 4 px stripe and a dot — never as a fill behind text.

**Type.** Barlow Condensed for names (apps, sections, the greeting) because condensed names fit long Spanish titles on a phone; IBM Plex Sans for text; IBM Plex Mono only for numbers. The handwritten wordmark is the one decorative element.

**Layout.**
```
phone                                   desktop
[wordmark ........... Administrar Salir][wordmark ....... name  Administrar  Salir]
Hola, Eric                              Hola, Eric          viernes 30 de octubre
viernes 30 de octubre                   [ Buscar una app…              ]
[ Buscar una app…              ]        Favoritas / Recientes  [card][card][card]
(Bodega)(Huerta)(Hospitalidad)  ← chips wrap, no scrolling
Favoritas / Recientes: stacked rows     ▌Bodega
▌Bodega                                 [card][card][card][card]
 ─ Calendario de bodega        ☆         › 2 más en camino: Sala de barricas · …
 › 2 más en camino
```
Phone gets a single-column list (rows ≥ 64 px), desktop a grid — research: linear lists beat 2D grids for low-literacy phone use.

**Principles.**
1. Only things that open look tappable. Placeholders collapse into one quiet line per section and never appear in Recientes or search.
2. Recents and favourites first (stored per person in the browser; nothing breaks without them).
3. Every number on a card carries its period and source; no fake data outside `?demo=1`.
4. Targets ≥ 48 px, focus visible, works with the fonts missing.

**Review against the brief.** First draft was a 2-column card grid on phones with each placeholder as its own dashed card — that is the generic app-store look and the screenshot showed placeholders taking over half the screen. Changed to a list on phones and one collapsed line per section for anything not yet usable.

## Standing rule (Eric, Oct 30): on mobile everything is vertical

No horizontal scrolling anywhere on a phone: no scrolling chip bars, carousels or wide tables. Chips wrap; lists stack; tables become cards below 720 px. `html, body { overflow-x: clip }` in the kit is the safety net, not the fix.

## Pass 2 — admin (Oct 30 2026)

- **People:** list ⇄ person on phones (one screen at a time, "‹ Everyone" back), side by side on desktop. Search by name or email, initials avatars, last sign-in in words. Adding a person is a 2-field form that lands straight on their access screen.
- **Access:** a 4-way picker per app (None / View / Edit / Admin), full width on phones with 40px+ targets, a one-line meaning for each role above the list, "Set all" per section. Confirmation only where it matters: making someone an app admin or a Hub admin, removing a person.
- **Apps:** the spreadsheet is gone. One card per app grouped by section; tap to open its fields, with plain labels ("How it opens", not "mode").
- **Activity:** the audit log reads as sentences ("Eric changed Jimena on Calendario de bodega from Viewer → Editor"), grouped by day in San Miguel time, filter by who and by kind of change. The API now records only what changed and the previous role.
- **Secrets / Health:** designed placeholders that show what phase 3 puts there.
- Checked: no element scrolls sideways at 360 px on any tab; tabs fit one line from 360 px up and wrap below that.

## Pass 3 — fresh-eyes review and the kit (Oct 30 2026)

A reviewer with no context checked screenshots and code. Fixed:
- **Contrast:** dark-mode primary button (2.4:1 → 7.4:1 with `--on-accent`), dark error toast (2:1 → 7.7:1), field borders now 3:1+ (`--field-rule`), favourite star 3:1+, locked people no longer faded.
- **Focus:** fields get a visible 2px focus outline.
- **Targets:** every button, link in the top bar, chip, tab, select, toggle and role option is ≥ 44 px. Measured on every page at 320 and 390 px: none smaller, nothing wider than the screen.
- **Words:** one set of role names in admin (No access / View / Edit / Admin); staff see Solo ver / Puede editar / Administra. "Por importar" is Próximamente for staff. Clearer offline and empty-section lines. No-access page has the logo, the reason and one way back.
- **Safety:** turning off "Can sign in" asks first.
- **Launcher on small lists:** chips appear only with 4+ sections; favourites and recents only with 5+ apps; a one-line hint teaches the star.
- **Kit:** `/kit/demo.html` shows every component with the markup to copy.
