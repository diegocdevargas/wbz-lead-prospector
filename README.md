# Webcraftz Prospector

Lead generation and qualification for Webcraftz. The full spec is in [CLAUDE.md](CLAUDE.md); runtime LLM prompts are in [prompts/](prompts/).

Plans and decisions: [dashboard](docs/dashboard.md), [assistant](docs/assistant.md), [security baseline](docs/security.md), [portfolio and future product](docs/productization.md), [ADRs](docs/decisions/). The "Source of truth" table in CLAUDE.md says which file owns which fact.

**Status: M2** — M1 (manual import, dedupe, opt-outs, LGPD export/delete) plus Google Places discovery by campaign (niche × cities), a website audit (PageSpeed + HTML checks + Google review signals) with findings in Portuguese, background jobs, and the dashboard's Campaigns, Audit tab, Jobs and Settings screens. No scoring or outbound yet (M3).

## Layout

```
apps/server/      Hono app: dashboard pages + routes. src/node.ts (local) and src/worker.ts (Cloudflare Workers)
packages/core/    Pure logic, no I/O: normalizers, dedupe decision, suppression hashing, CSV column mapping, config
packages/db/      Drizzle schema, SQL migrations, DB clients (node-postgres locally, Neon WebSocket pool on Workers)
prompts/          LLM prompts (used from M3)
```

Inside `apps/server/src/services/`: `discovery.ts` (campaigns, Places pages), `audit.ts` (website audit), `google.ts` (Places, PageSpeed, cache, budget), `jobs.ts` (queue), `prune.ts` (retention). Pure rules live in `packages/core/src/`: `ssrf.ts`, `html-audit.ts`, `findings.ts`, `places.ts`, `reviews.ts`.

## Run locally

Needs Node 22, pnpm 10 and Docker (or any Postgres 16 with `pg_trgm`).

```sh
pnpm install
cp .env.example .env              # then set SUPPRESSION_SECRET: openssl rand -hex 32
pnpm db:up                        # Postgres in Docker on 127.0.0.1:${POSTGRES_PORT} (default 5432)
pnpm db:migrate
pnpm db:seed                      # optional: 20 fake leads (.test domains, no phone numbers)
pnpm dev                          # http://127.0.0.1:8787
```

`.env.example` sets `AUTH_MODE=none`, which is only accepted when `ENVIRONMENT=development`.

To run the Workers build locally, copy `apps/server/.dev.vars.example` to `apps/server/.dev.vars` and run `pnpm dev:worker`. It needs a Neon database URL, because the Neon WebSocket driver cannot talk to a plain local Postgres.

## Tests

```sh
docker compose exec postgres createdb -U postgres prospector_test   # once (or use your own createdb)
pnpm db:migrate:test       # migrates DATABASE_URL_TEST
pnpm test                  # reads DATABASE_URL_TEST from .env
pnpm test:unit             # pure logic only, no database
pnpm lint && pnpm typecheck
```

`.env.example` already has `DATABASE_URL_TEST`; no inline env vars are needed, so the same commands work in PowerShell, cmd and bash.

**Port 5432 already in use** (for example by another Postgres, such as n8n's)? Set `POSTGRES_PORT=5433` in `.env` and use the same port in `DATABASE_URL` and `DATABASE_URL_TEST`, then run `pnpm db:up` again. A "password authentication failed for user postgres" error usually means the URL is reaching a different Postgres than the one from `docker-compose.yml`.

**Windows:** the repo keeps LF line endings (`.gitattributes`), because Biome rejects CRLF. If `pnpm lint` flags every file after cloning, run `git config core.autocrlf false`, then `git rm --cached -r . -q && git reset --hard` (or re-clone).

The database tests truncate every table, so point `DATABASE_URL_TEST` at a disposable database. CI runs lint, typecheck, migrations, all tests and `pnpm audit` against a Postgres service.

## How import and dedupe work

Every import (CSV, paste or the single-lead form) runs in **one transaction**. A failure on any row rolls the whole import back, and the preview is the same code path run as a transaction that is rolled back on purpose. An advisory lock serializes imports.

For each row:

1. Validate with Zod. Bad optional fields (phone, email, CNPJ, URL) are dropped with a warning; a missing company makes the row `invalid`.
2. Normalize: domain (social and link-in-bio hosts never count), phone to E.164 (BR default), CNPJ with check digits, name without accents and legal suffixes.
3. **Opt-out check**: if the email, phone, domain or CNPJ is on the opt-out list, the row is discarded and its data is not stored.
4. Match in the spec's order: domain, phone, CNPJ, fuzzy name + city.
   - Same domain, same or unknown city: **merge**.
   - Same domain, different city: **review** (likely another branch).
   - Same phone, names similar ≥ `phoneNameMinSimilarity` (0.5): **merge**; otherwise **review**.
   - Same CNPJ: **merge**.
   - Same city and niche-stripped name similarity ≥ `fuzzyThreshold`: **review**. Fuzzy matches never merge on their own.
5. Merges only fill empty fields; they never overwrite. Every value is also written to `field_sources` with its source and date.

"Review" creates the lead and queues the pair on the Duplicates page, where you merge or dismiss it.

Name similarity uses pg_trgm's algorithm. `packages/core/src/similarity.ts` reimplements it exactly (tests check it against Postgres's own values), so the decision logic stays pure and testable.

## How discovery and the audit work (M2)

1. **Campaign** (`/campaigns`): a niche as people search it ("clínica odontológica"), a list of cities ("Chapecó, SC"), a query template (`{niche} em {city}`) and a **Places request cap**.
2. **Run** queues one job per city. Each job calls Places **Text Search (New)** for one page (20 results), up to `places.maxPagesPerQuery` pages per city. Before every call the campaign's request counter is incremented in one conditional `UPDATE`; at the cap the job stops and the campaign shows `stopped_budget`. Raising the cap resumes the skipped pages.
3. Each place goes through the **same import pipeline as a CSV row**: validation, opt-out check, dedupe (place_id first, then domain → phone → CNPJ → fuzzy name + city). Closed businesses are skipped.
4. Each new or matched lead gets an **audit job**:
   - No website: a `no_website` finding.
   - Website: fetched through the SSRF-safe fetcher (http(s) on 80/443, public IPs only on every redirect, 5 redirects, 10 s, 2 MB, no cookies). HTML checks: HTTPS, viewport, title/description, H1s, WhatsApp link, online booking, contact form, copyright year, platform (WordPress, WooCommerce, Shopify, Nuvemshop, VTEX, Linx, Tray, Loja Integrada, Wix, Squarespace, custom), chat widget, and 20 internal links checked for 404/5xx.
   - **PageSpeed Insights** (mobile): score, LCP, CLS and INP (INP is real-user data, so small sites often have none).
   - **Google reviews** (Place Details, up to 5 reviews): counted for pain phrases ("demoram para responder", "difícil agendar", ...). Only the counts are kept; text and reviewer names are discarded in memory.
   - Findings are deterministic rules (`packages/core/src/findings.ts`, thresholds in config), written in Portuguese with the number behind them, e.g. "Site leva 9,2s para carregar no celular (PageSpeed 23/100)." The lead moves `discovered → audited`.
   - What the site itself confirms (name, phone, website, Instagram handle) is recorded in `field_sources` as `website_audit`.
5. **Retention** (daily job, [ADR-0004](docs/decisions/0004-google-places-retention.md)): Google's terms only allow keeping `place_id` indefinitely. Places values (phone, website, address, Maps URL, rating, review count) expire after 30 days unless another source backs them (the site, CNPJ, a manual import). The name is kept as the lead's identifier. Cached API responses expire; audit HTML excerpts are deleted after 90 days.

**Jobs** ([ADR-0005](docs/decisions/0005-jobs-table.md)): the `jobs` table is the source of truth (status, attempts, last error, next run). The queue only carries job ids: Cloudflare Queues in production, an in-process queue locally. Enqueueing is idempotent on a key, a job runs once even if delivered twice, failures retry with backoff (30 s × 4ⁿ, up to 6 h) and become `dead` after `jobs.maxAttempts`. A cron sweep every minute re-sends due jobs and recovers stuck ones. `/jobs` shows all of it, with a retry button.

### Google API key and cost

Create one key in Google Cloud with **Places API (New)** and **PageSpeed Insights API** enabled, restricted to those two APIs (and to your server's IP if it is fixed). Set it as `GOOGLE_API_KEY`. Without it, campaigns can be created but not run, and audits skip PageSpeed and reviews.

Text Search with phone, website and rating fields is billed as Text Search Enterprise, and review text as Place Details Enterprise + Atmosphere. Google gives a free monthly allowance per SKU (check the current numbers in the Google Maps Platform pricing page). The campaign screen shows the **list-price** estimate (`places.textSearchCostUsd`, `places.placeDetailsCostUsd`), without subtracting the free allowance. A 3-city campaign costs at most 3 × 3 pages + 1 Place Details per lead, which the default cap of 100 covers. Responses are cached 30 days, so re-running a campaign does not bill twice. PageSpeed Insights is free.

## Configuration

Non-secret tunables live in `packages/core/src/config.ts` with defaults: model names, dedupe thresholds, niche stopwords and import limits. Override any of them with the `APP_CONFIG` env var as JSON, e.g. `APP_CONFIG={"dedupe":{"fuzzyThreshold":0.7}}`.

| Env var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres URL. On Workers it must be a Neon URL (WebSocket pool, so transactions work). |
| `SUPPRESSION_SECRET` | 32+ chars. Keys the opt-out hashes. **Never rotate it**: rotating orphans every existing opt-out. |
| `ENVIRONMENT` | `development`, `test` or `production` (default). |
| `AUTH_MODE` | `access` (default), `basic`, or `none` (development only). |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access team domain and application audience tag. |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` | For `AUTH_MODE=basic` (password 12+ chars). |
| `APP_CONFIG` | Optional JSON overrides, see above. |
| `GOOGLE_API_KEY` | Optional. One key restricted to Places API (New) + PageSpeed Insights. Without it, discovery is off. |

The app validates its env at startup and refuses to run half-configured. For example, it rejects production without auth, a short secret, or Access mode without its settings.

## Deploy (Cloudflare Workers)

1. Create a Neon project and run `DATABASE_URL=<neon url> pnpm db:migrate`.
2. In Cloudflare Zero Trust, create an Access application for the Worker's hostname, allow only your email, and copy its **Audience (AUD) tag**.
3. Set `CF_ACCESS_TEAM_DOMAIN` in `apps/server/wrangler.toml`, then:
   ```sh
   cd apps/server
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put SUPPRESSION_SECRET
   npx wrangler secret put CF_ACCESS_AUD
   npx wrangler secret put GOOGLE_API_KEY
   npx wrangler queues create wbz-jobs
   pnpm deploy
   ```
4. Turn off the `workers.dev` route or leave it: requests without a valid Access JWT get 401 either way.

Hyperdrive can replace the Neon WebSocket pool later; `wrangler.toml` has the binding commented out.

`wrangler.toml` binds the `JOBS` queue (producer and consumer) and two cron triggers: every minute (job sweep) and 06:00 UTC (retention). The audit parses HTML, which needs more CPU than the Workers Free plan's 10 ms per invocation, so production needs **Workers Paid** (US$5/month). Locally, `pnpm dev` runs jobs in-process with the same sweep and retention schedule, at no cost.

## Security and privacy notes

- **Auth fails closed.** In production the Worker verifies the Cloudflare Access JWT (signature via Access JWKS, issuer, audience), not just its presence. Only `/healthz` is public.
- **CSRF**: form posts must come from the same origin (Hono `csrf`). Every page is server-rendered with escaped output. A strict CSP (`default-src 'none'`, no inline scripts or styles) is set, along with `frame-ancestors 'none'`, `Cache-Control: no-store` and HSTS in production.
- **Inputs**: Zod-validated forms and query strings. Request size limits are 64 KB, or 5 MB plus 5,000 rows for imports. Malformed ids return 404, and only `http(s)` URLs are stored or linked.
- **SSRF**: the audit fetcher only reaches public addresses (checked after DNS and on every redirect). Residual risk: the runtime resolves DNS again when connecting, so DNS rebinding is not fully covered; on Workers outbound traffic cannot reach a private network anyway.
- **Logs** hold method, path (no query string), status and timing. Request bodies and row data are never logged.
- **LGPD**:
  - Only business contact data is stored, with the source and date of every field.
  - Each lead page can export everything stored about it as JSON, or delete it. Deleting removes its raw import rows too, and by default adds its keys to the opt-out list.
  - Opt-outs are HMAC hashes, so the list can match values but cannot be read back.
  - Adding an opt-out moves matching existing leads to `opted_out` straight away.
