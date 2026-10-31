# Hub design notes

Running notes for the design passes. Rules come from `DESIGN-RESEARCH.md`.

## Pass 1 — launcher (Oct 30 2026)

**Job of the page:** get a person into the app they need in one tap, on a phone, outdoors.

**Colour.** The Cellar Target Calendar palette, unchanged so the apps feel like one family: paper `#fffefb` on stone `#f4f3ef`, ink `#1f2426`, bordeaux `#6b2737` as the only accent for actions. Seven section hues (bodega wine, huerta green, hospitalidad ochre, ventas blue, marketing violet, equipo teal, admin grey) appear only as a 4 px stripe and a dot — never as a fill behind text.

**Type.** Barlow Condensed for names (apps, sections, the greeting) because condensed names fit long Spanish titles on a phone; IBM Plex Sans for text; IBM Plex Mono only for numbers. The handwritten wordmark is the one decorative element.

**Layout.**
```
phone                                   desktop
[wordmark ............ Admin  Salir]    [wordmark ....... name  Admin  Salir]
[Bodega Huerta Hospitalidad … →]  ←sticky section chips (phone only)
Hola, Eric                              Hola, Eric          viernes 30 de octubre
viernes 30 de octubre                   [ Buscar una app…                      ]
[ Buscar una app…              ]        Recientes  [card][card][card][card]
Recientes  ‹card›‹card›‹card› →         ▌Bodega
▌Bodega                                 [card][card][card][card]
 ─ Calendario de bodega        ☆         Próximamente: Sala de barricas · Bitácora…
 ─ …
 Próximamente (2)  ▸
```
Phone gets a single-column list (rows ≥ 64 px), desktop a grid — research: linear lists beat 2D grids for low-literacy phone use.

**Principles.**
1. Only things that open look tappable. Placeholders collapse into one quiet line per section and never appear in Recientes or search.
2. Recents and favourites first (stored per person in the browser; nothing breaks without them).
3. Every number on a card carries its period and source; no fake data outside `?demo=1`.
4. Targets ≥ 48 px, focus visible, works with the fonts missing.

**Review against the brief.** First draft was a 2-column card grid on phones with each placeholder as its own dashed card — that is the generic app-store look and the screenshot showed placeholders taking over half the screen. Changed to a list on phones and one collapsed line per section for anything not yet usable.
