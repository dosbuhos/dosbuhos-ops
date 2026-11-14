# Runbooks

| Situation | What happens automatically | What a person does |
|---|---|---|
| **Ads are overspending / anything looks wrong** | Watchdog raises a critical alert at the protective-stop threshold | Controls → *Pause managed ads*. If the app is unreachable: Google Ads → Campaigns → select → Pause. Running ads keep spending during any outage |
| **Unknown outcome on a change** | The resource stays reserved and conflicting changes are refused; critical alert | Agent activity → *Reconcile with Google Ads*. It only reads |
| **External change detected** (owner/agency edited a budget the app manages) | Rolling limits count it; a stale proposal is rejected; reconciliation suspends the resource | Check who changed it and why, then Controls → *Acknowledge*. Set `managed_by` if someone else controls that campaign |
| **Google Ads feed stopped** | `stale_spend` alert; growth writes blocked | Google Ads → Scripts → check the run log. A 401 means the token was rotated: create a new one and paste it in |
| **Revoked OAuth** (Phase 2) | Connection goes to *Reconnection needed*; the coordinator emergency-locks on an `auth` error | Reconnect from Connections; review locked actions; unlock |
| **API sunset / version change** | — | Re-read `docs/integrations.md` sources, update the adapter and fixtures, run `npm run check` |
| **Schema migration** | — | Add `migrations/000N_….sql`; apply to demo, then staging, then production with `wrangler d1 migrations apply`, before deploying code that needs it |
| **Failed deployment** | Workers keeps the previous version | Workers → growth → Deployments → roll back |
| **Negative results** | Reports say so plainly; nothing is hidden or smoothed | Use the weekly report's checks (tracking, capacity, seasonality, recent changes) before changing anything. "No change" is a valid decision |
| **Restore from backup** | — | 1) Restore D1 with Time Travel (`wrangler d1 time-travel restore growth --timestamp …`). 2) Coordinator: `restoreAll(dump)` from the latest R2 backup (`backups/coordinator/…`). It starts in EMERGENCY_LOCK with a restore lock. 3) Controls → *Reconcile now*. 4) Unlock only after reviewing |
| **Policy change** | A new policy version; open approvals bound to the old version can't be approved | Re-propose if needed |
| **Cloudflare-wide outage** | Nothing runs (common-mode limitation) | Manage directly in Google Ads. Optional external uptime monitoring with owner agreement |

Backups: Controls → *Back up coordinator* writes a full export to R2. D1 has Time Travel point-in-time restore; check its current retention for the owner's plan before relying on it.

Ownership: the Cloudflare account, this repository, the Google Cloud project and the Anthropic Console account must all belong to Dos Búhos, not to a developer.
