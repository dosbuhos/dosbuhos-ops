# Cotizador de eventos

The Acrobat quoter (Cotizador Para Eventos) as a phone app: capture the event, the space and food & beverage; the quote, the per-person price, the minimum-spend check and the internal numbers update as you type; **Propuesta** renders the one-page "Su cotización" (print → PDF) and **WhatsApp** shares a text summary.

- Worker `cotizador` · static app in `public/` + a small Worker (`src/worker.js`) that gates it with a PIN.
- Secrets (dashboard → cotizador → Settings → Variables and Secrets): `PIN` — the team's PIN. Without it the app is open. `HUB_SECRET` (= the Hub's `SESSION_SECRET`) lets the Hub's signed proxy header in without a PIN.
- Deploys on push through Workers Builds (project `cotizador`, root `cotizador`, deploy `npx wrangler deploy`).
- Prices and rules live in the `P` object at the top of `public/index.html` (menus, bar tiers by hour, minimum spend, space rates and caps, service and IVA). Same logic as the Acrobat form.
- The quote in progress is kept in the browser (localStorage); "Nueva" clears it. No database yet.
