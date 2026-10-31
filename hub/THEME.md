# Theme — one look for every Dos Búhos app

Eric sets the look in **Hub → Admin → Diseño**. The Hub serves it as CSS custom properties; every app reads the same
`--db-` names. The theme changes **look** only: colours, fonts, text size, corners, border width, spacing, touch-target
size, logos. Layout and behaviour (what is on a screen, mobile-vertical rule, navigation) live in each app's code and
change only with a code change.

## Add it to an app (copy-paste)

```html
<link rel="stylesheet" href="https://hub.dos-buhos.workers.dev/theme.css?app=<app-slug>">
```

Put it **before** the app's own stylesheet. `?app=` is the slug in the Hub registry (`cellar`, `huerto`, `mantenimiento`,
`spark`, `wineclub`, `muestras`…); it lets Diseño pin that app to a preset (e.g. Huerto → Huerta). Without it the app
gets the main theme. When the custom domain is live use `https://apps.dosbuhos.com/theme.css?app=<slug>`.
Apps served through the Hub (`/huerto/…`) may use the relative `/theme.css?app=huerto`.

Then map the app's existing variables onto the tokens, keeping today's value as the fallback so nothing breaks when the
theme can't load:

```css
:root {
  --bg: var(--db-bg, #f4f3ef);
  --card: var(--db-surface, #fffefb);
  --text: var(--db-ink, #1f2426);
  --muted: var(--db-muted, #5d6568);
  --rule: var(--db-line, #dcd9d1);
  --accent: var(--db-accent, #6b2737);
  --on-accent: var(--db-on-accent, #fff);
  --ok: var(--db-ok, #3d6a38);  --bad: var(--db-bad, #b42318);  --warn: var(--db-warn, #8f6200);  --off: var(--db-off, #5d6568);
  --f-display: var(--db-font-display, "Barlow Condensed", sans-serif);
  --f-body: var(--db-font-body, "IBM Plex Sans", system-ui, sans-serif);
  --radius: var(--db-radius, 10px);
}
body { font-size: var(--db-size-base, 16px); font-weight: var(--db-weight-body, 400); }
h1, h2, .title { font-family: var(--f-display); font-weight: var(--db-weight-display, 600); }
button, input, select, .tap { min-height: var(--db-tap, 44px); }
```

If the app has its own dark-mode block, map the same names there too (`--bg: var(--db-bg, #141719)` etc.): theme.css
switches the `--db-` values for dark itself. Remove the app's own Google Fonts `<link>` once it uses the tokens
(theme.css `@import`s the chosen fonts), or keep it as a fallback. `hub/public/kit/kit.css` is a worked example.

## Tokens (the contract — apps use only these names)

Colours (each has a light and a dark value; dark applies under `prefers-color-scheme: dark` unless
`<html data-theme="light">`, and always under `<html data-theme="dark">`):

| Token | Meaning |
|---|---|
| `--db-bg` | page background |
| `--db-surface` | cards, sheets, top bar |
| `--db-surface-2` | second surface (derived: between surface and bg) |
| `--db-ink` | text |
| `--db-muted` | secondary text |
| `--db-line` | borders, dividers |
| `--db-line-strong` | field borders (derived: ≥ 3:1 on surface) |
| `--db-accent` | primary action, links, current tab |
| `--db-accent-soft` | soft accent fill (derived) |
| `--db-on-accent` | text on accent |
| `--db-ok`, `--db-bad`, `--db-warn`, `--db-off` | status: listo / atrasado / resguardo / inactivo |
| `--db-ok-soft`, `--db-bad-soft`, `--db-warn-soft`, `--db-off-soft` | pill backgrounds (derived); status colour on its soft passes 4.5:1 |
| `--db-focus` | focus box-shadow (`0 0 0 3px …`) |

Type, shape, density, brand (same in both modes):

| Token | Values |
|---|---|
| `--db-font-display`, `--db-font-body` | full font stacks with fallbacks |
| `--db-weight-display` | 600, or 400 for single-weight display faces (never faux bold) |
| `--db-weight-body` | 400 or 500 (heavier, for outdoor use) |
| `--db-size-base` | 16, 17 or 18 px; `--db-size-sm` (−2), `--db-size-lg` (+4) |
| `--db-radius` | 6, 10 or 14 px; `--db-radius-sm`, `--db-radius-lg` |
| `--db-border` | 1, 1.5 or 2 px |
| `--db-space-1` … `--db-space-6` | spacing scale: compacta 2/4/8/12/16/24 · normal 4/8/12/16/24/32 · amplia 6/10/16/22/32/44 |
| `--db-tap` | minimum touch target: 44 / 48 / 56 px (never below 44) |
| `--db-density` | `compacta` \| `normal` \| `amplia` (informational) |
| `--db-focus-ring` | `2px solid var(--db-accent)` for `outline` |
| `--db-short-name` | quoted string, usable in `content:` |
| `--db-logo` | `url(…)` of the logo for the current mode, or `none` in dark mode when there is no dark logo |
| `--db-logo-light`, `--db-logo-dark`, `--db-icon` | only defined when uploaded |

## Endpoints

Public (no sign-in, `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=60, stale-while-revalidate=600`, ETag/304):

- `GET /theme.css[?app=slug]` — the tokens above, Google Fonts `@import`
- `GET /theme.json[?app=slug]` — `{ version, app, pinned, theme, tokens: { light, dark, common }, assets }`
- `GET /theme/logo-light`, `/theme/logo-dark`, `/theme/icon` — the uploaded images (404 when none)

Admin (Hub admins, signed in): `GET /api/admin/theme` (active, history, presets, fonts, logos, AI status) ·
`PUT /api/admin/theme` `{ theme, note }` (validates schema + contrast; 422 with the failing pair and ratio) ·
`POST /api/admin/theme/activate` `{ id }` (rollback) · `POST|DELETE /api/admin/theme/logo/{logo-light|logo-dark|icon}`
(multipart `file`, PNG/SVG/JPEG/WebP ≤ 300 KB) · `POST /api/admin/theme/import` (JSON body `{ text, instructions, base }`
or multipart with `file` .json/.md/.txt; JSON → merged over `base`, text/instructions → Claude; returns a preview, never saves).
Saves, rollbacks and logo changes are written to the audit log (Admin → Activity).

## Theme document (what is stored, what import accepts)

```json
{ "preset": "bodega", "name": "Bodega clásica",
  "light": { "bg": "#f7f3ec", "surface": "#fffdf8", "ink": "#1f1a1b", "muted": "#5c5355", "line": "#ddd4c8",
             "accent": "#6b2737", "on-accent": "#ffffff", "ok": "#2f6634", "bad": "#ae2318", "warn": "#855700", "off": "#5f5c5b" },
  "dark":  { "…": "same keys" },
  "fontDisplay": "Fraunces", "fontBody": "IBM Plex Sans", "size": 16, "weightBody": 400,
  "radius": 10, "border": 1, "density": "normal",
  "brand": { "shortName": "Dos Búhos" }, "apps": { "huerto": "huerta" } }
```

Any subset is a valid import (`{ "size": 18 }`); `preset` resets the colours/type/shape to that preset first (brand and
app pins are kept). Presets, fonts and the rules are in `public/kit/theme-core.js` (shared by the Worker and the admin page).

Contrast rules (both modes, enforced on save): ink on bg and on surface ≥ 4.5 (7 preferred) · muted on bg/surface ≥ 4.5 ·
on-accent on accent ≥ 4.5 · accent on surface ≥ 4.5 (it is used for links) · ok/bad/warn/off on bg ≥ 4.5 and on their soft
fills ≥ 4.5.

## Setup notes

- Tables `theme_versions` and `theme_assets` are created at runtime (`CREATE TABLE IF NOT EXISTS`); no migration to run.
  Logos are not versioned (they apply on upload); everything else is, with rollback.
- AI import needs secret `ANTHROPIC_API_KEY` on the `hub` Worker (Cloudflare → Workers → hub → Settings → Variables and
  Secrets → Add → Secret). Optional var `AI_MODEL` (default `claude-sonnet-5-5`). Without it, presets, controls and JSON import work.
- Tests: `npm test` (node:test, no dependencies).
