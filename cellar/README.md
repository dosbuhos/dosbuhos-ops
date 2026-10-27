# Cellar Target Calendar (Calendario de bodega)

The Claude artifact, running on Cloudflare Workers. `app/cellar-targets.html` is the artifact source, unchanged;
`app/web-shim.js` gives it the same `window.claude.use(...)` API it had on claude.ai, backed by this Worker:

| Artifact capability | Here |
|---|---|
| `db` (lots, tasks, protocols, trials, audit, vineyard, settings, woqueue, wocache, labcache) | D1 `cellar`, table `docs`: `/api/db/:collection[/:id]`, polled every 15 s with ETags |
| `mcp` Google Sheets (Excellovint) | `/api/sheets` → Sheets API with a service account; only `SHEET_ID` |
| `sample` (Learn tutor, blend-trial tidy-up) | `/api/ai` → Claude API (`ANTHROPIC_API_KEY`) |
| `user` | Google sign-in; `VIEWER_EMAILS` are read-only |
| `downloads` | normal browser download |

## Update the page from a new artifact version

```
python3 cellar/app/build.py path/to/cellar-targets.html   # writes public/index.html + public/web-shim.js
```

## One-time setup

1. Cloudflare → Workers → Create → Import a repository → `dosbuhos-ops`, root directory `cellar`, deploy command `npm run deploy`.
2. Secrets on the `cellar` Worker: `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ALLOWED_EMAILS`, `GOOGLE_SA_JSON`, `ANTHROPIC_API_KEY` (optional `VIEWER_EMAILS`). Emails stay out of Git: this repo is public.
3. Google Cloud (same project as wineclub): add `https://cellar.<subdomain>.workers.dev/auth/callback` to the OAuth client's redirect URIs; create a service account and a JSON key → `GOOGLE_SA_JSON`; share Excellovint with the service account's email as Editor.
4. Copy the artifact's database into D1 right before switching over (done from Claude with the artifact export).
