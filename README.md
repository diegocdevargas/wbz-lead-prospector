# Webcraftz Prospector

Lead generation and qualification for Webcraftz. The full spec is in [CLAUDE.md](CLAUDE.md); runtime LLM prompts are in [prompts/](prompts/).

Plans and decisions: [dashboard](docs/dashboard.md), [assistant](docs/assistant.md), [security baseline](docs/security.md), [portfolio and future product](docs/productization.md), [ADRs](docs/decisions/). The "Source of truth" table in CLAUDE.md says which file owns which fact.

**Status: M1** — manual import (CSV, paste, form), dedupe with a review queue, opt-out list, LGPD export/delete, and a dashboard lead list. No discovery, audits, scoring or outbound yet.

## Layout

```
apps/server/      Hono app: dashboard pages + routes. src/node.ts (local) and src/worker.ts (Cloudflare Workers)
packages/core/    Pure logic, no I/O: normalizers, dedupe decision, suppression hashing, CSV column mapping, config
packages/db/      Drizzle schema, SQL migrations, DB clients (node-postgres locally, Neon WebSocket pool on Workers)
prompts/          LLM prompts (used from M3)
```

## Run locally

Needs Node 22, pnpm 10 and Docker (or any Postgres 16 with `pg_trgm`).

```sh
pnpm install
cp .env.example .env              # then set SUPPRESSION_SECRET: openssl rand -hex 32
pnpm db:up                        # Postgres in Docker on 127.0.0.1:5432
pnpm db:migrate
pnpm db:seed                      # optional: 20 fake leads (.test domains, no phone numbers)
pnpm dev                          # http://127.0.0.1:8787
```

`.env.example` sets `AUTH_MODE=none`, which is only accepted when `ENVIRONMENT=development`.

To run the Workers build locally, copy `apps/server/.dev.vars.example` to `apps/server/.dev.vars` and run `pnpm dev:worker`. It needs a Neon database URL, because the Neon WebSocket driver cannot talk to a plain local Postgres.

## Tests

```sh
createdb prospector_test   # or: docker compose exec postgres createdb -U postgres prospector_test
DATABASE_URL=postgres://postgres:postgres@localhost:5432/prospector_test pnpm db:migrate
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/prospector_test pnpm test
pnpm test:unit             # pure logic only, no database
pnpm lint && pnpm typecheck
```

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
   pnpm deploy
   ```
4. Turn off the `workers.dev` route or leave it: requests without a valid Access JWT get 401 either way.

Hyperdrive can replace the Neon WebSocket pool later; `wrangler.toml` has the binding commented out.

## Security and privacy notes

- **Auth fails closed.** In production the Worker verifies the Cloudflare Access JWT (signature via Access JWKS, issuer, audience), not just its presence. Only `/healthz` is public.
- **CSRF**: form posts must come from the same origin (Hono `csrf`). Every page is server-rendered with escaped output. A strict CSP (`default-src 'none'`, no inline scripts or styles) is set, along with `frame-ancestors 'none'`, `Cache-Control: no-store` and HSTS in production.
- **Inputs**: Zod-validated forms and query strings. Request size limits are 64 KB, or 5 MB plus 5,000 rows for imports. Malformed ids return 404, and only `http(s)` URLs are stored or linked.
- **Logs** hold method, path (no query string), status and timing. Request bodies and row data are never logged.
- **LGPD**:
  - Only business contact data is stored, with the source and date of every field.
  - Each lead page can export everything stored about it as JSON, or delete it. Deleting removes its raw import rows too, and by default adds its keys to the opt-out list.
  - Opt-outs are HMAC hashes, so the list can match values but cannot be read back.
  - Adding an opt-out moves matching existing leads to `opted_out` straight away.
