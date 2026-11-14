# Canario de reservas

Checks twice a day (8:00 and 11:00 San Miguel time) that guests can book, and sends a phone alert when they cannot.

- **Tables:** next 5 open days (Wed–Sun), 2 and 4 people, slots between 10:00 and 16:00. Zero slots = alert; under 8 for 2 people = warning.
- **Experiences:** each of the 5; alert when one has no slots on any of the next 5 open days.
- **Website:** /restaurante/ and /wine-tour/ load, carry OpenTable links with `restref=1258120`, and have no Rezdy links.
- **Status page:** `/` (last result), `/run` (check now), `/status.json`.
- **Alerts:** ntfy.sh topic in `wrangler.jsonc` (`NTFY_TOPIC`). Install the ntfy app and subscribe to that topic.
- **Planned closures:** add dates to `SKIP_DATES` in `wrangler.jsonc`.
- **"BLIND" status:** OpenTable did not answer the canary (blocked, or its query hashes changed). Update `HASH` in `src/worker.js` from the booking page's network calls.

No login and no secrets: it reads the same public pages a guest sees. It cannot see who changed what in Guest Center.
