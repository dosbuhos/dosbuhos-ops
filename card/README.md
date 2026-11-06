# Tarjeta QR · link tree

The QR business card + mini site for the team: `hola.dosbuhos.com` (also `card.dos-buhos.workers.dev`), generic at `/` and `/eric`, `/diane`, `/higinio`, `/melanie`, `/michael`.
Front = the black card with the person's QR; tap → the menu (About, Tours, Restaurant, Events, Wines, Wine club, Recognition, Photos, Contact, Press). EN/ES. Installable (Add to Home Screen) and works offline (`public/sw.js`). Press kit at `/press/`.

- Static Worker (assets only). Deploys on push through Cloudflare Workers Builds (project `card`, root directory `card`, deploy command `npx wrangler deploy`). Live at https://card.dos-buhos.workers.dev
- Content and links: edit `CONFIG`, `WINES_APP`, `AWARDS`, `PHOTOS` at the top of `build_app.py`, then `python3 build_app.py` (needs Pillow) and push. Or edit `public/index.html` directly.
- QR cards for phones: `cards/*.png` (regenerate with `make_card.py`; QRs point to this Worker).
- vCards: `public/vcf/`. Photos: `public/photos/`.
