# Cloudflare account: Dos Búhos

## Account
- Account name: Dos Buhos. Account ID: 3d8be07bd3d63420eeb17a98058584fd
- workers.dev subdomain: dos-buhos.workers.dev (a Worker named `foo` is at https://foo.dos-buhos.workers.dev)
- dosbuhos.com DNS is on Cloudflare. The Hub is at apps.dosbuhos.com.
- Never change DNS, MX or Email Routing for dosbuhos.com. Email runs on Google Workspace.

## Repo and layout
- GitHub repo: dosbuhos/dosbuhos-ops. One folder per app (hub/, cellar/, horizonte/, cotizador/, canario/ ...).
- A new app gets its own folder with wrangler.jsonc, src/, and migrations/ if it uses D1.
- Add a row for the new app to the table in the root README.md.

## Deploying
- Deploys happen through Workers Builds: push to `main` and Cloudflare builds and deploys.
- Never run `wrangler deploy` by hand. `wrangler deploy --dry-run` and `wrangler dev` are fine.
- Before pushing: `git pull --rebase`, then push to main.
- A new Worker has to be created once in the dashboard (Workers & Pages → Create → Continue with GitHub → dosbuhos-ops),
  with the Worker name set and Build → Root directory set to `/<folder>`. Ask Eric to do this step, or to sign in so you can.
  Cancel the first automatic build if the root directory is still `/`.

## wrangler.jsonc conventions
- `compatibility_date`: "2026-10-01" (use "2026-11-01" plus `nodejs_compat` only if a dependency needs it)
- `workers_dev: true`
- Static files: `assets` with `directory: ./public`, and `run_worker_first` for /api/* and /auth/*
- Comment each binding and var with what it is for.

## D1 databases
- Create the database, then put its id in wrangler.jsonc under `d1_databases` with `migrations_dir: "migrations"`.
- Every schema change is a numbered .sql file in `migrations/` (0001_init.sql, 0002_...).
- Apply it to the remote database, and record it in the `d1_migrations` table so wrangler sees it as applied.
- Never edit an old migration. Add a new one.

## Secrets
- Never put secrets in the repo, in wrangler.jsonc vars, or in chat.
- Tell Eric the secret's name and where it goes (Worker → Settings → Variables and Secrets). He pastes the value himself.
- Shared secrets live in the account Secrets Store (for example ANTHROPIC_API_KEY, bound with `secrets_store_secrets`).
- List required secrets in a comment at the bottom of wrangler.jsonc.

## Sign-in and the Hub
- Staff apps sit behind the Hub (apps.dosbuhos.com), which handles Google sign-in and proxies to each app
  under /<slug>/ through a service binding, adding a signed X-DB-User header.
- To put an app behind the Hub: add a service binding in hub/wrangler.jsonc and a row in the Hub's apps registry.
- A standalone app uses Google Identity Services with its own OAuth client in Google Cloud project `dos-buhos`.

## Other bindings already in use
- KV, D1, Browser Rendering (`"browser": { "binding": "BROWSER" }` with @cloudflare/puppeteer), cron triggers.
- Cron times are UTC. San Miguel de Allende is UTC-6 all year.

## House rules
- Staff-facing text is in Spanish. Code comments are in English.
- Keep each app small and self-contained. No shared build step across folders.
- Add a short README.md in the app folder: what it does, its routes, its bindings, and its secrets.
- Before reporting done: run the tests, run `wrangler deploy --dry-run`, and check the live URL after the build.
