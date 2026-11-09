# Horizonte

Eric's personal planner (a Timestripe replacement). Not part of the Hub. Scope doc: https://claude.ai/artifact/VHUh7KTVdjGVcsLvYGQZWc · mockups: https://claude.ai/artifact/4zTphj8jvWM5wUiVjzwQf5

- Worker `horizonte`, D1 `horizonte`, live at horizonte.dos-buhos.workers.dev
- Local-first: the app keeps every task in the device's IndexedDB and works offline; changes queue in an outbox and sync through `POST /api/sync` (field-by-field, latest edit wins — `src/merge.js`)
- Sign-in: Google, only `OWNER_EMAIL`. Uses the Hub's OAuth client; needs secrets `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` and the redirect URI `https://horizonte.dos-buhos.workers.dev/auth/callback` in Google Cloud. Without them the app still works on one device, without sync
- Front end: plain JS, no build step (`public/app.js`, `public/app.css`), Geist self-hosted, service worker for offline start
- Desktop ≥900 px: list panel + timeline (Hours / Days / Weeks / Months / Quarters / Years), drag and drop. Phone: Today / Plan / Capture / Boards / Inbox, schedule sheet, swipe right = done, swipe left = schedule, hold + drag = week rail

## Phases (from the scope doc)
1. Core planner — **this version**
2. Google Calendar two-way sync, appointments, reflow
3. Google Tasks inbox
4. Timestripe import
5. Daily score
6. Voice + assistant

## Dev
```
npm test                                   # merge rules
npx wrangler d1 migrations apply horizonte --local
npx wrangler dev --port 8799 --var DEV_USER:emaycotte@gmail.com --var SESSION_SECRET:x
node test/seed.mjs && node test/shots.mjs http://localhost:8799 /tmp/shots
```
