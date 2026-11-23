# Horizonte

Eric's personal planner (a Timestripe replacement). Not part of the Hub. Scope doc: https://claude.ai/artifact/VHUh7KTVdjGVcsLvYGQZWc · mockups: https://claude.ai/artifact/4zTphj8jvWM5wUiVjzwQf5

- Worker `horizonte`, D1 `horizonte`, live at horizonte.dos-buhos.workers.dev
- Local-first: the app keeps every task in the device's IndexedDB and works offline; changes queue in an outbox and sync through `POST /api/sync` (field-by-field, latest edit wins — `src/merge.js`)
- Sign-in: the Sign in with Google button (Google Identity Services), only `OWNER_EMAIL`. Uses its own OAuth client ("Horizonte"), no secret for sign-in: the Worker checks the ID token against Google's public keys and keeps a random session id in D1. Needs `https://horizonte.dos-buhos.workers.dev` as an Authorized JavaScript origin on the client. Without sign-in the app still works on one device
- Front end: plain JS, no build step (`public/app.js`, `public/app.css`), Geist self-hosted, service worker for offline start
- Desktop ≥900 px: list panel + timeline (Hours / Days / Weeks / Months / Quarters / Years), drag and drop. Phone: Today / Plan / Capture / Boards / Inbox, schedule sheet, swipe right = done, swipe left = delete (Undo), hold + drag to a day or hour

## Phases (from the scope doc)
1. Core planner — **this version**
2. Google Calendar two-way sync, appointments — **done**. (Reflow, which slid today's timed tasks as you finished early or ran over, was removed in v65: nothing on the calendar moves on its own.)
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

## Releases
Every change bumps the version in three places: `?v=` in index.html, `V` and the `SHELL` URLs in sw.js. The app re-checks the worker whenever it comes to the front and reloads itself when a new one takes control (v64), so a phone left on an old build catches up on its own.

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
Hours shows the day as an agenda (v44): "Anytime" tasks on deck, then the scheduled items on a time rail with the now line and free gaps named; the clock button in the header switches to the hour grid.
Boards, In review and Settings live under the grid icon top-left. Tapping an empty slot in the grid opens Capture at that time.
Past days list what did not get done; dropping an Inbox task on a day stays in Hours on that day.

## Phone Hours (v48)
The phone's Hours screen is the hour grid, full height, opened at the now line. Nothing sits above it but fold rows (one 36px line each):
"N unscheduled ▸" (expands to the quick-add row and the day's untimed tasks; tap
the row when empty to add), and on past days "N not done" (open by default; drag a task forward, or open it and Remove date).
Done tasks fold under the unscheduled row. Untimed work is meant to be dragged in from Inbox or a board, so there is no on-deck list.
Bottom bar: one sideways-scrolling ribbon with every view (Inbox · Late · Hours · Days · Weeks · Months · Quarters · Years · Horizons); the current tab is kept in view.

## Phone Late tab (v50)
Open tasks whose day or period has passed (meetings excluded) get their own tab between Inbox and Hours, with the count on the bar.
They are grouped under the day they were planned for, newest first ("Yesterday", "Thursday, Nov 19 · 2 days ago", or the week/month label),
with "All to today" in the header. Rows are plain cards (no per-row button): tap to reschedule in the sheet, hold to drag onto a day or hour, swipe left to delete (Undo in the toast).
Hours and Inbox no longer carry an overdue line. Phone sheets have an × in the handle row, and dragging the handle no longer triggers the
browser's pull-to-refresh.

## Months (v62)
Months is a real calendar on both layouts: a Mon–Sun grid where meetings are colour bars (titles on desktop, bars on the phone),
each day's task load is a thin bar (desktop also prints "3 tasks · 2h", or "2 not done" in amber on a past day), today is ringed.
Tap a day to open it in Hours; drop a task on a day to schedule it. Under the grid: a roll-up line ("5 meetings · 2 done · 20 open · 13h 30m")
and the tasks placed on the month itself. Desktop shows the month's list in a column on the right; ‹ › and swipe move one month.
Weeks, Quarters and Years are still the stacked task lists.

## Phone drag: the day slides (v63)
Holding a task opens the full-screen day (`renderDayDrop`). Resting the finger on the left or right edge lights that edge and,
after the dwell, the day turns like a page: the title and the blocks of the day on screen slide out and the next day's slide in
under the task being held (`ddSwap`, 340 ms; no slide with reduced motion). The frame is drawn once and stays still: the arrows,
the two slots and the hour labels. The header keeps one height whether or not the day has a Today/Tomorrow pill, and the grid that
is leaving stops being a drop target. Same behaviour as Pulso (`mantenimiento/`), added from that app's chat at Eric's request.

## Phone density spec
One set of numbers for every phone screen (CSS under `.m`), so nothing is sized per screen:
- Grid 4px. Screen gutters 14px. List gap 0 (rows touch, hairline dividers). Section gap 12px.
- Type: screen title 17/700 (secondary 17/500 muted); row text 15/500; meta 12; micro 11; bottom bar 16/500, active 700. Line height 1.25.
- Rows (v47): flat, not boxed — 40px min, padding 5/2/5/4, hairline bottom border, no radius or shadow; title clamped to 2 lines; tags inline at the right of the title (10px chips, max 2 + "+N"); meta 11px; the default 30m duration is not shown. Meetings stay solid colour blocks (radius 8). Checkbox box 20px inside a 44px hit area.
- Controls: icon buttons 40×40 (44 hit area), text buttons 36px, segmented 36px; sheet buttons/fields 44px.
- Hours: week strip letters 11 / numbers 15 in a 32px circle; quick-add row 40px; grid 56px per hour, 36px gutter with 11px labels; fold rows 36px.
- Floating + 52px; bottom bar 44px rows + safe area.
Audit = screenshot every screen at 360/390/430, light and dark, and check: nothing overflows, no text spills its card, every tap target ≥36px visual / 44px hit, and the numbers above are the only ones in use.
