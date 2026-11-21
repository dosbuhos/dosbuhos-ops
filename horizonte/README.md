# Horizonte

Eric's personal planner (a Timestripe replacement). Not part of the Hub. Scope doc: https://claude.ai/artifact/VHUh7KTVdjGVcsLvYGQZWc · mockups: https://claude.ai/artifact/4zTphj8jvWM5wUiVjzwQf5

- Worker `horizonte`, D1 `horizonte`, live at horizonte.dos-buhos.workers.dev
- Local-first: the app keeps every task in the device's IndexedDB and works offline; changes queue in an outbox and sync through `POST /api/sync` (field-by-field, latest edit wins — `src/merge.js`)
- Sign-in: the Sign in with Google button (Google Identity Services), only `OWNER_EMAIL`. Uses its own OAuth client ("Horizonte"), no secret for sign-in: the Worker checks the ID token against Google's public keys and keeps a random session id in D1. Needs `https://horizonte.dos-buhos.workers.dev` as an Authorized JavaScript origin on the client. Without sign-in the app still works on one device
- Front end: plain JS, no build step (`public/app.js`, `public/app.css`), Geist self-hosted, service worker for offline start
- Desktop ≥900 px: list panel + timeline (Hours / Days / Weeks / Months / Quarters / Years), drag and drop. Phone: Today / Plan / Capture / Boards / Inbox, schedule sheet, swipe right = done, swipe left = schedule, hold + drag = week rail

## Phases (from the scope doc)
1. Core planner — **this version**
2. Google Calendar two-way sync, appointments, reflow — **done** (reflow: today only, timeboxed tasks; finish early → following tasks slide up; run over → the block keeps its length and slides under the now line, pushing what follows; meetings and pinned tasks fixed; per-day switch in the Hours header)
3. Google Tasks inbox
4. Timestripe import
5. Daily score — **done as “In review”** (day/week: time by meetings/done/open, by board and tag, targets, pushed, one suggested move; `r` on desktop, Review link on the phone's Today)
6. Voice + assistant — **MCP endpoint done** (see below)

## Assistants (MCP)
`POST /mcp/<token>` (or `POST /mcp` with `Authorization: Bearer <token>`) is a stateless MCP server over Streamable HTTP (JSON-RPC; no SSE, no sessions). Tokens are minted in Settings → Assistants (`/api/tokens`, session auth) and stored as SHA-256 in `api_tokens`; the link is shown once. Tools: `get_day`, `list_tasks`, `list_boards`, `add_task`, `update_task`, `complete_task`, `delete_task`, `day_summary`. Writes go through `applyOps` with device clock `mcp`, so devices converge and meetings push to Google Calendar. Code: `src/mcp.js`.
- Claude.ai: Settings → Connectors → Add custom connector → paste the link.
- ChatGPT: Settings → Connectors → Create (developer mode) → MCP server URL, no authentication.

## Reminders (web push)
Settings → Reminders turns push on per device (Chrome/Android/desktop; iPhone only once added to the Home Screen). Two kinds, from the 5-minute cron (`src/push.js`): a nudge 10 minutes before a timed task (meetings are left to Google Calendar) with a Done action, and a morning digest at 9:00 in the planner's time zone. VAPID keys are generated once into `meta`; subscriptions in `push_subs`; `push_sent` dedupes. Library: `@block65/webcrypto-web-push` (RFC 8291/8292 on WebCrypto). No secrets to configure. Add `--test-scheduled` to `wrangler dev` and request `/__scheduled` to run the cron locally.

## Dev
```
npm test                                   # merge rules
npx wrangler d1 migrations apply horizonte --local
npx wrangler dev --port 8799 --var DEV_USER:emaycotte@gmail.com --var SESSION_SECRET:x
node test/seed.mjs && node test/shots.mjs http://localhost:8799 /tmp/shots
```

## Timestripe import (done Nov 9 2026)
Read from the Timestripe web app in Eric's Chrome (read-only) and posted to `POST /api/import` with a one-time token from `import_tokens` (deleted after). Mapping: own boards → boards (buckets → sections); open board tasks → same board; past-dated open day/week/month/quarter goals with no board → **Backlog**, original date in notes; future goals keep their placement; Life horizon → Someday; recurring tasks collapsed to one; completed and untitled tasks skipped. Imported ids are `ts_<timestripe id>`, so a re-run updates instead of duplicating. Not imported: "Feature Requests" (a public board he follows) and "⭐️ Garden Project" (owned by another account).

## Phone layout (v41)
Timestripe-style: a scrolling bar at the bottom (Inbox · Hours · Days · Weeks · Months · Quarters · Years · Horizons), Hours as the default view
with a week strip (tap a day, swipe the strip for the next week, swipe the screen for the next day), an inline "Add…" row, and a floating +.
Boards, In review, Overdue and Settings live under the grid icon top-left. Tapping an empty slot in the grid opens Capture at that time.
Past days list what did not get done, each with a "Today ›" button, and a "Move all to today" bar; dropping an Inbox task on a day stays in Hours on that day.
