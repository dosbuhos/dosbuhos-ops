# Integrations — readiness and version-sensitive findings

**Verification date:** 2026-11-14
**Scope:** Dos Búhos Growth Terminal (`growth/`). Nothing below proves what the owner's accounts can do. **Re-verify every row against the specific account** (plan, region, approvals, admin rights) before building or enabling an adapter.

## How to read the evidence column

| Status | Meaning |
|---|---|
| **verified (read today)** | Official page content read on 2026-11-14. |
| **search-index only** | The official page **could not be fetched** from this research session: DNS for `developers.google.com`, `support.google.com`, `developers.rezdy.com` and `docs.opentable.com` was blocked by the session's network allowlist. The finding comes from a web-search summary of the official page (and sometimes third-party pages). Treat it as a lead, not a fact. |
| **could not verify** | No official source found, or only third-party sources. |
| **background (unverified)** | Long-standing, widely documented behavior that was not re-checked today. |

> To upgrade "search-index only" rows to "verified", re-run this research with the hosts above allowed in the session network settings.

## Readiness table

| Provider | Purpose | Current access | Read operations | Write operations | Prerequisites | Limitations | Fallback | Evidence |
|---|---|---|---|---|---|---|---|---|
| **Google Ads Scripts** (read feed) | Phase 1 ingestion: campaigns, IDs, cost micros, budgets, search terms, change history, POSTed to Worker | **In use by `hub/`** (daily campaign rows, bearer token). Richer growth payload: to build | Anything the Scripts `AdsApp` / GAQL `AdsApp.search` can report | None from the Worker. A script can mutate the account, but the growth app should keep scripts read-only | Admin/standard user on the Ads account to author the script; Worker endpoint plus bearer secret | Execution typically **30 min** per run (60 min for MCC `executeInParallel`). UrlFetchApp daily quotas not confirmed officially. Hourly schedule at most. Limits "can change without warning" | Manual CSV export from the Ads UI | search-index only: https://developers.google.com/google-ads/scripts/docs/limits |
| **Google Ads API** (reads + limited mutations) | Future adapter: direct GAQL reads; guarded mutations (budget, pause, negatives) | Unknown — to verify | GAQL `GoogleAdsService.Search/SearchStream` | Campaign/budget/criterion mutates; conversion uploads and adjustments | Google Cloud project with an approved **API access level** (see §Google Ads API); OAuth client; `login-customer-id` if using a manager account | Explorer/Basic levels cap daily operations; monthly version releases with roughly 1-year sunsets | Ads Scripts feed (Phase 1) | search-index only: https://developers.google.com/google-ads/api/docs/api-policy/access-levels |
| **Google Data Manager API** (offline conversions) | Future: upload OpenTable-sourced bookings/visits as Google Ads offline conversions | Unknown — to verify | n/a (ingest API) | `events:ingest` (offline conversions); adjustments (restate value / add user data) via the same `IngestEvents` | OAuth scope `https://www.googleapis.com/auth/datamanager`; destination `operating_account` = Ads customer ID, `account_type=GOOGLE_ADS`; conversion action set up for imports | **Retractions not supported** in Data Manager (restatements are). Needs gclid/gbraid/wbraid or user-provided data | Google Ads API `ConversionUploadService` / `ConversionAdjustmentUploadService`, or manual CSV upload in Ads UI | search-index only: https://developers.google.com/data-manager/api/devguides/events/google-ads/offline ; https://developers.google.com/data-manager/api/devguides/events/google-ads/conversion-adjustments |
| **GA4 Data API** | Site traffic / conversions for attribution checks | Unknown — to verify (GA4 status unknown) | `runReport`, `runRealtimeReport`, `batchRunReports` | None | GA4 property exists; service account or OAuth user with Viewer; scope `analytics.readonly` (background) | Standard property: 200k core tokens/day, 40k/hour, 14k per project per property per hour, 10 concurrent | GA4 UI exports; BigQuery export (if linked) | search-index only: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas |
| **Google Tag Manager API** (audit only) | Audit that tags/conversion linker/consent fire correctly | Unknown — to verify (GTM status unknown) | List accounts/containers/workspaces/tags/triggers/versions | **None by policy** (audit only) | GTM container exists; user with Read; scope `tagmanager.readonly` | 10,000 requests/day/project; 0.25 QPS/project | Manual review in GTM UI; Tag Assistant | search-index only: https://developers.google.com/tag-platform/tag-manager/api/v2/limits-quotas |
| **OpenTable** | Bookings for restaurant **and** experiences (site buttons use `restref`) | Booking system in use; **API access unknown — to verify** | Partner API (availability, reservations, guest/CRM, sync feeds) is **partner-only** | Partner API booking/cancel (partner-only) | Signed partner agreement + OAuth 2.0 client credentials (partner) | Restaurants do not appear to get self-serve API access; rate limits set in contract | **GuestCenter CSV exports** (Reporting > Reservations; Reporting > Guests > Guest Export), per third-party guides; scheduled manual upload to R2 | search-index only: https://docs.opentable.com/ ; https://dev.opentable.com/partner-portal/faqs |
| **Rezdy** | — | **Not used** (owner confirmed 2026-11-14) | — | — | — | — | — | No adapter is built. Experiences book through OpenTable. |
| **Zoho Bigin API** | Leads / pipeline (events, wine club, groups) | Unknown — to verify | Records in Contacts, Pipelines (formerly Deals), etc. | Create/update records | Zoho OAuth client; scopes `ZohoBigin.<scope>.<op>`; correct Zoho data-center domain | Credit-based rolling 24 h limit (third-party figures: Free 5,000; paid 50,000 + 250/user, max 100,000) plus concurrency limits. v2: Deals renamed Pipelines in URLs and scopes | Bigin CSV export | search-index only: https://www.bigin.com/developer/docs/apis/v2/scopes.html |
| **Zoho Inventory API** | Wine sales / inventory (sell-through vs ad spend) | Unknown — to verify | Items, sales orders, invoices, packages, etc. | Possible, but **not planned** | Zoho OAuth client; `organization_id`; correct data-center domain | **100 requests/min/org**; daily cap per plan (sources conflict: Standard 2,000 vs 2,500; Premium 10,000 vs 75,000) | Zoho reports export | search-index only: https://www.zoho.com/inventory/api/v1/introduction/ ; https://www.zoho.com/inventory/kb/automation/per-day-api-limit.html |
| **Parrot POS** (ParrotConnect) | Restaurant covers/revenue | Unknown — to verify (POS "reportedly" Parrot) | **No public API or developer portal found** | None | Ask Parrot sales/support about integrations or exports | Unknown | Parrot report exports (CSV/Excel) or CFDI invoice data; manual upload | could not verify (no official developer docs found; company sites parrotsoftware.io not reachable/indexed with API docs) |
| **Meta Marketing API** | Meta ads spend/performance | **In use by `hub/`** via system-user token | Insights, campaigns/ad sets/ads | Possible with `ads_management`; not planned | Business Manager system user + token; `ads_read` (background) | Graph/Marketing API versioned (~2-year lifetime per version, background); v26.0 released 2026-07-29 | Ads Manager CSV export | search-index only: https://developers.facebook.com/docs/graph-api/changelog/version26.0 |
| **Anthropic API** | Analysis / recommendations inside the app | Unknown — to verify (key provisioning) | n/a | Messages API calls | API key (`x-api-key`) + `anthropic-version` header; org in Console | Rate limits per **organization** by usage tier (RPM, input TPM, output TPM); spend limits per month | Degrade to rule-based summaries | search-index only: https://docs.anthropic.com/en/api/rate-limits (pricing: see costs.md placeholder) |

---

## Google Ads Scripts (Phase 1 read feed)

- Pattern already proven in `hub/`: script inside the Ads account → `UrlFetchApp.fetch` POST to Worker with bearer token. No developer token or Cloud project needed.
- **Limits** (search-index only, https://developers.google.com/google-ads/scripts/docs/limits): execution time typically 30 minutes; manager-account scripts using `executeInParallel` with a callback up to 60 minutes. Google says limits can change without warning.
- UrlFetchApp quotas: only old forum figures (e.g. 20,000 fetches/day) found. **Not confirmed.** A recent Google developer forum thread reports unexplained "Bandwidth quota exceeded" errors from Ads Scripts. Design for this: batch rows into few POSTs, make retries idempotent, keep each JSON body under a fixed size cap.
- Recommendation: one POST per entity type per run, with an idempotency key `(customer_id, date, entity, run_id)`.

## Google Ads API

**Access model — the claim checks out (search-index only, not page-verified):**
- Official docs, as indexed: *"API access levels are associated with Google Cloud projects. We sunset developer tokens on September 9, 2026. Your current and active developer token access level was automatically transferred to your Google Cloud projects based on API activity in the 90 days preceding the sunset."* Access levels "are now determined by the Google Cloud project you used to generate your OAuth credentials."
  Source: https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- Levels still enforced: **Test Account Access, Explorer, Basic, Standard**. Basic/Standard need review. Standard is "unlimited operations".
- Verification step suggested by Google: compare the level in the manager account's **API Center** with the Cloud project's **Google Ads API Overview** page; reapply if they differ. Google says the API Center "will completely sunset in the future".
- Related: blog "A new onboarding experience for Google Ads API developers" (2026-09): https://developers.google.com/ads/blog/posts/2026/09/new-onboarding-experience-for-google-ads-api
- **Inconsistency to report:** some indexed docs still describe the old model. Examples: `first-call/dev-token` pages, and text like *"New sign-ups are issued a developer token with the Test Account Access level"* and *"if you have a developer token with Basic Access level … fill out the Standard Access level application form"*. The two models cannot both be current. Read the live access-levels page and the Cloud console before deciding whether a `developer-token` header is still required by client libraries. Earlier in 2026 (Feb) Google acknowledged a backlog in access applications: https://developers.google.com/ads/blog/posts/2026/02/an-update-on-google-ads-api-developer
- Exact daily operation caps for Explorer/Basic were **not obtained**. Quotas are reportedly per Cloud project over a sliding 24 h window (third-party; unverified).

**Versions / sunsets (search-index only):**
- Release cadence: monthly in 2026. An Oct 12, 2026 post says **two releases per month starting with v26**, sunset schedules unchanged, and minor releases sunset with their parent major. https://developers.google.com/ads/blog/posts/2026/10/google-ads-api-release-and-sunset
- Reported sunsets: v20 on 2026-06-10 (done); v21 ~Aug 2026 and v22 ~Oct 2026 (projected; likely already sunset); **v23 Feb 2027; v24 May 2027; v26 Nov 2027** (projected). Check https://developers.google.com/google-ads/api/docs/sunset-dates before pinning.
- Auth: OAuth 2.0, scope `https://www.googleapis.com/auth/adwords` (background).

**Offline conversions via Google Ads API** (https://developers.google.com/google-ads/api/docs/conversions/upload-offline): **could not verify.** The page did not load and the search index gave no usable summary. Background (unverified): click conversions are uploaded with `ConversionUploadService.UploadClickConversions`. Adjustments (restatement, **retraction**, enhancement) go through `ConversionAdjustmentUploadService`. Google publishes an "upgrade to Data Manager API" guide for offline conversions (https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/upgrade), which signals that Data Manager is the preferred path.

## Google Data Manager API (offline conversions)

All findings are search-index only:
- **Offline conversion upload for Google Ads is supported**: guide "Google Ads offline conversions": https://developers.google.com/data-manager/api/devguides/events/google-ads/offline
- Endpoint `POST https://datamanager.googleapis.com/v1/events:ingest`. OAuth scope **`https://www.googleapis.com/auth/datamanager`**, which is a different scope from the Ads API. Adding it to existing Ads credentials triggers re-consent.
- Destination: `operating_account.account_id` = Ads conversion customer ID, `account_type = GOOGLE_ADS`; optional `login_account`.
- **Adjustments:** supported via `IngestEvents`. An adjustment can **restate the conversion value or supplement user data**, matched on transaction ID + destination + conversion action. You don't specify an adjustment type. https://developers.google.com/data-manager/api/devguides/events/google-ads/conversion-adjustments
- **Retractions: NOT supported** in Data Manager. Google Ads API retractions (value and count set to zero) are the stated alternative. A Stape community thread claiming no adjustment support at all looks outdated.
- Behavior difference: Data Manager does **not** return duplicate-transaction-ID errors, so the app must dedupe itself.
- Design implication: a cancelled OpenTable booking already uploaded as a conversion needs the **Google Ads API (or a UI upload)** to retract it. Alternatively, upload only on "seated/completed" status, after a delay.

## GA4 Data API

Search-index only: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- Standard property: 200,000 core tokens/day, 40,000/hour; **14,000 tokens per project per property per hour**; 10 concurrent requests; daily reset at midnight Pacific. Analytics 360 is 10× these.
- Token cost scales with request complexity. Use `returnPropertyQuota: true` to monitor usage.
- Conflict: a 2023 Google blog cites 1,250 tokens per project per property per hour. Treat it as outdated.
- Auth: service account added as a property Viewer; scope `https://www.googleapis.com/auth/analytics.readonly` (background).

## Google Tag Manager API (audit only)

Search-index only: https://developers.google.com/tag-platform/tag-manager/api/v2/limits-quotas
- 10,000 requests/day/project; 0.25 QPS/project; 403 when exceeded.
- Use `https://www.googleapis.com/auth/tagmanager.readonly` only. Never request `edit.containers` or `publish` scopes.

## Google Ads budgets — average daily budget overdelivery

Search-index only: https://support.google.com/google-ads/answer/1704424/ (and https://support.google.com/google-ads/answer/1704443)
- **Daily:** actual spend on a given day can be **up to 2×** the average daily budget.
- **Monthly charging limit:** **30.4 × average daily budget** for most campaigns (e.g. $10/day → $304/month max). Google credits overdelivery above this.
- Exception: Pay-for-conversions campaigns have no daily limit but stay within the monthly limit.
- App implication: daily-pacing alerts must expect days at up to 2× budget. Alert on **month-to-date vs 30.4 × budget**, not on single-day overspend.

## Google alcohol ad policy — Mexico

Search-index only: https://support.google.com/adspolicy/answer/6012382 (plus https://support.google.com/adspolicy/answer/16427711, https://support.google.com/adspolicy/answer/16428720)
- Mexico appears on the **allowed** lists for alcohol **informational/branding ads**. Mexico also appears on the list for ads for the **online sale of alcohol**, but some list entries carry conditional asterisks, so the exact Mexico conditions were not confirmed.
- A **policy restructure** (a single unified table of allowed countries, effective **2026-09-30**) is reported by a third-party blog only. **Unconfirmed.** The current page may differ from older summaries.
- Action: before launching wine-sale campaigns, read the live country table for "alcohol sale" vs "alcohol information". Also confirm age targeting and any certification requirement for Mexico.

## OpenTable

Search-index and third-party only: https://docs.opentable.com/ , https://dev.opentable.com/partner-portal/faqs
- APIs (Online Booking / In-House or "Voice AI" Booking, CRM guest records, partner sync feeds) are **partner-gated**. They need a signed partner agreement and OAuth 2.0 (token endpoint → bearer). Rate limits are set at contracting. Scraping and unapproved access are prohibited.
- **No evidence that a restaurant can get its own reservation data by API without becoming or using an approved partner.** Assume it cannot until OpenTable confirms in writing.
- **Exports:** GuestCenter → Reporting → Reservations (CSV) and Reporting → Guests → Guest Export, per third-party migration guides (Resy, ResDiary, Slang, Tock). Guest details may be limited for diners who have not opted in to marketing. Regional GuestCenter domains vary.
- Recommended Phase 1: staff upload a weekly CSV export to R2 → parser → D1. Map experiences vs restaurant by OpenTable listing/`restref`.

## Rezdy

Not used. The owner confirmed on 2026-11-14 that Rezdy is no longer in use; experiences (tours, tastings) are booked through OpenTable like the restaurant. No Rezdy adapter, webhook route or credentials exist in this app.

## Zoho Bigin

Search-index only: https://www.bigin.com/developer/docs/apis/v2/scopes.html
- API **v2** current. v1 clients are kept backward-compatible, but migrating is recommended. v2 renamed the **Deals module to Pipelines** (URLs, responses, scopes).
- Scopes format `ZohoBigin.<scope_name>.<READ|CREATE|WRITE|DELETE|ALL>`. Request read-only scopes for Phase 1.
- Limits: credits over a rolling 24 h window plus concurrency limits. Per-edition figures come from a third party only.
- Zoho OAuth is data-center specific (accounts.zoho.com vs .eu/.in/etc.). Confirm the account's DC (background).

## Zoho Inventory

Search-index only: https://www.zoho.com/inventory/api/v1/introduction/ , https://www.zoho.com/inventory/kb/automation/per-day-api-limit.html
- **100 requests/minute per organization** (HTTP 429 beyond).
- Daily caps per plan **conflict between Zoho pages**: API docs list Free 1,000 / Standard 2,000 / Professional 5,000 / Premium 10,000 / Enterprise 10,000. The KB lists Standard 2,500 / Premium 75,000. Zoho can raise limits on request (support, with Organization ID).
- Requires `organization_id` on calls; OAuth scopes `ZohoInventory.<module>.READ` (background).

## Parrot POS

- **No public API or developer documentation found** (search returned company/product profiles only: TechCrunch, YC, G2/Capterra). The product is ParrotConnect, a Monterrey-based cloud POS with CFDI invoicing.
- Action: ask Parrot whether it offers an API, report exports, or integrations. Until then, the fallback is manual export upload.

## Meta Marketing API

Search-index only: https://developers.facebook.com/docs/graph-api/changelog/version26.0 , https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog/versions
- **v26.0 released 2026-07-29** (Graph and Marketing API). Some Meta changelog snapshots still say v25.0 is latest. v24.0 was listed as available until 2026-10-06 (now past). v23.0 reportedly sunset 2026-06-09.
- v25/v26 deprecated some Page/video reach metrics. These return errors on all versions after the v26 release. Check that the hub's insights fields are not affected.
- Check which version `hub/` pins. If it is ≤ v24, it may already be failing or close to failing.
- Auth: system-user token in Business Manager, `ads_read` for reads (background).

## Anthropic API

Search-index only: https://docs.anthropic.com/en/api/rate-limits (also https://docs.claude.com/en/api/rate-limits)
- Auth: `x-api-key` header + `anthropic-version` header (e.g. `2023-06-01`).
- Rate limits are per **organization** by usage tier: RPM, input tokens/min, output tokens/min. There are also monthly spend limits. Sources disagree on whether tier advancement is still spend-based. Responses carry `anthropic-ratelimit-*` headers; honor `retry-after` on 429.
- Pricing: intentionally **not** covered here. See the "Model usage" placeholder in `costs.md`.
