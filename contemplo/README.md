# Contemplo Studio

Video library and projection control for Contemplo (Dos Búhos). Upload MP4s from any computer, copy them to the Google
TV Streamer, and run the projection from a phone. During a show it runs over the local Wi-Fi and doesn't need internet.

```
Laptop / phone ──HTTPS──▶ Hub (apps.dosbuhos.com/contemplo/) ──▶ Worker `contemplo` ──▶ D1 `contemplo` + R2 `contemplo-media`
                                                                     ▲
Google TV Streamer (app "Contemplo Studio") ──HTTPS heartbeat 2.5 s──┘   (pairing, sync, commands, status)
        │ plays only local, SHA-256-verified files (two ExoPlayers for gap-free GO)
        └── LAN server http://<tv>:8320/ ◀── operator's phone/laptop on the same Wi-Fi (live show: CUE/GO/…; no internet)
```

## Pieces

| Path | What |
|---|---|
| `src/index.js` | Worker: staff API (behind the Hub), device API (bearer token), R2 multipart uploads, Range streaming, daily cleanup cron |
| `public/` | Dashboard (`index.html`, `app.js`), live show page (`show.html`, `show.js`, shared with the TV), `sha256.js` (incremental hash while uploading) |
| `migrations/` | D1 schema (`0001_init.sql`) |
| `android/` | Kotlin TV player: `Engine` (dual player, CUE/GO, blackout, end actions), `MediaStore` (resumable verified downloads), `Cloud` (pairing, heartbeat, acks), `LanServer` (port 8320), `BootReceiver` |
| `docs/INSTALL.md` | Building and installing the APK on the Google TV Streamer |
| `docs/OPERACION.md` | Staff guide in Spanish: daily use, live show, troubleshooting, HDMI checklist |
| `test/` | `sha256.test.mjs` (unit), `e2e.mjs` (full flow against `npm run dev`) |

## Routes

Staff (Hub-signed `X-DB-User`; writes need header `X-Contemplo: 1`; viewer / editor / admin from the Hub grant):

- `GET /api/me` · `GET /api/videos` · `PATCH|DELETE /api/videos/:id` · `GET /api/media/:id` (Range) · `GET|PUT /api/thumb/:id`
- Uploads: `POST /api/uploads` → `PUT /api/uploads/:id/part/:n` (32 MiB parts) → `POST /api/uploads/:id/complete {parts, sha256, duration_ms, width, height}` · `POST /api/uploads/:id/abort`
- Devices: `GET /api/devices` · `POST /api/devices/pair {code, name}` (admin) · `GET|PATCH|DELETE /api/devices/:id` · `GET /api/devices/:id/media` · `POST /api/devices/:id/sync {video_ids}` · `DELETE /api/devices/:id/sync/:video` · `GET /api/devices/:id/events`
- Commands: `POST /api/devices/:id/commands {type, payload}` → `GET /api/commands/:id` (pending → delivered → done | failed | expired) · `POST /api/commands/:id/retry`
- Lists: `GET|POST /api/playlists` · `PUT|DELETE /api/playlists/:id` (whole list replaced atomically)

Device (`Authorization: Bearer <token>`): `POST /api/device/pair/start` · `POST /api/device/pair/poll` · `POST /api/device/heartbeat` · `POST /api/device/ack` · `GET /api/device/media/:id` (Range) · `GET /api/device/thumb/:id`

Public: `/tv` redirects to the newest APK release. `/healthz`.

TV LAN server (`http://<tv>:8320/`, PIN from Pantallas): `/` show page · `POST /api/lan/login` · `GET /api/state` · `GET /api/library` · `POST /api/cmd` · `GET /media/:id` (Range) · `GET /thumb/:id`

## Rules the code keeps

- Nothing reports success until the TV acknowledges it. The LAN server answers only after the player has acted. Cloud commands are acknowledged by the TV.
- A cloud command not picked up within 90 s expires and is never run later, so a TV that comes back online doesn't start playing on its own.
- A video is playable only after a full download and a SHA-256 match. A playlist starts only when all its files are ready. If any are missing, what's on screen keeps playing.
- Cleanup never deletes what is on screen, what is cued, or anything in the running playlist.
- No UI over the video: no player controls, no notifications from the app, no filenames. Diagnostics appear only when the remote's center/menu button is pressed.

## Bindings and secrets

D1 `DB` (`contemplo`), R2 `MEDIA` (`contemplo-media`), Secrets Store `HUB_SESSION_SECRET`. **No secrets to paste.** Each TV gets its own token at pairing; only the token's hash is stored.

## Develop and deploy

```
npm install && npm run db:local && npm run dev      # http://localhost:8787 signs you in as a local admin
npm test && node test/e2e.mjs some.mp4               # e2e needs the dev server
npm run check                                        # wrangler deploy --dry-run
```
Deploy = push to `main` (Workers Builds, root directory `/contemplo`). The APK builds in GitHub Actions
(`.github/workflows/contemplo-apk.yml`) and is published as a release on `main`.
