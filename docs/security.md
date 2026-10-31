# Security baseline

The system holds business contact data (LGPD), API keys that cost money, and a WhatsApp number and email domain whose reputation is hard to rebuild. These are the threats that matter here and the control for each, with the milestone that adds it. Everything in this file applies to every milestone.

## What we protect

1. **Lead data**, so it isn't leaked, kept past an opt-out, or shown in demo mode.
2. **Sending reputation**: the email subdomain, the WhatsApp Business number, and the Instagram account.
3. **Money**: Google, Anthropic and Meta keys, plus budget caps.
4. **Integrity of outbound**, so nothing goes out that Diego did not approve.

## Controls

| Area | Control | Status |
| --- | --- | --- |
| **Auth** | Cloudflare Access JWT verified in the app (signature, issuer, audience). Fails closed. Basic auth only for local or staging | M1 ✅ |
| **Public routes** | Only `/healthz`, `/webhooks/*` and `/o/*` (opt-out links) are public. Each one has its own check: webhook signature or signed token. Bypass Access only for those paths, and add a test that every other route returns 401 without auth | M3/M4 |
| **Browser** | Strict CSP (no inline script or style), CSRF origin check, `frame-ancestors 'none'`, HSTS, `no-store` | M1 ✅ |
| **Input** | Zod on every form, query, webhook body, env var and LLM output. Body size limits | M1 ✅, continues |
| **Webhooks** | WhatsApp: verify `X-Hub-Signature-256` with a timing-safe compare on the raw body, return 200 fast, dedupe by message id, enqueue. Reject replays older than 5 minutes when the payload has a timestamp | M4 |
| **Opt-out links** | HMAC-signed token (lead id and channel), no expiry, one click, no login. Works even if the lead was deleted | M3 |
| **SSRF (website audit)** | The audit fetches URLs from untrusted sources. Allow only `http(s)` on ports 80 and 443. Resolve DNS and block private, loopback, link-local and metadata ranges (also after each redirect). At most 5 redirects, 10s timeout, 2 MB body cap, no cookies. Fixture tests for each rule | M2 |
| **Untrusted text into LLMs** | Website HTML, reviews, Instagram bios and WhatsApp messages can carry prompt injection. Wrap them as quoted data in prompts. Agent tools are scoped to the current lead id on the server, not by what the model passes. Tools that change state validate their arguments. The model can't send first-contact outbound (drafts only) or change stage outside the allowed transitions | M2–M4 |
| **LLM output** | Zod schema, one retry, then manual review. Rendered escaped, never as HTML. Links in drafts are only the expected `wa.me` and opt-out hosts | M3 |
| **Outbound kill switch** | `OUTBOUND_ENABLED` env flag (default `false` outside production) checked right before every send, plus the daily cap and the suppression check at send time, not only at draft time | M3 |
| **Secrets** | Only in env and Wrangler secrets. Validated at startup. Never logged. Keys restricted by API and referrer or IP where the provider allows it (Google key: Places and PageSpeed only). One key per environment. Never rotate `SUPPRESSION_SECRET`; rotate the others yearly or on any leak | M1 ✅, per key |
| **Logs** | No bodies at info level. Phones and emails masked. No query strings. Request id on every line | M1 ✅ |
| **Audit log** | Who did what: approvals, edits, sends, deletes, exports, opt-outs, config changes. Append-only table. `stage_events` already covers stages | M3 |
| **Rate limits** | Per-IP limit on public routes. Per-provider token bucket on outgoing API calls, with response caching | M2–M4 |
| **Budget caps** | Per-campaign caps for Places and Claude, checked before the call, not after | M2/M3 |
| **Dependencies** | Dependabot, `pnpm audit` in CI, lockfile frozen. New dependency only with a stated reason | M1 ✅ |
| **CI and repo** | Least-privilege workflow permissions (`contents: read`). Branch protection on `main` (PR plus green CI). GitHub secret scanning and push protection on. Actions pinned to a major version | Turn on in GitHub settings now |
| **Data lifecycle** | LGPD export and delete per lead. Suppressions as HMAC. Raw API responses and audit HTML kept 90 days, then pruned by a cron job. Neon point-in-time restore on (7 days) | M1 ✅, pruning in M2 |
| **Dashboard assistant** | Read-only tools; writes are proposals the operator confirms; never sends outbound. See [assistant.md](assistant.md) | M3–M5 |
| **Demo mode** | Separate deployment, separate database, seeded fake data, no outbound credentials at all. See [ADR-0003](decisions/0003-demo-separate-deployment.md) | M5 |

## Before each milestone merges

- Run the `security-review` skill on the branch diff and fix or note each finding in the PR.
- Every new public route has a negative test (bad signature, missing token).
- Every new external call has a timeout, a retry policy and a fixture.
- `.env.example` and the README env table list every new variable.

## If something leaks

1. Set `OUTBOUND_ENABLED=false` and redeploy.
2. Rotate the affected key in the provider console, then `wrangler secret put`.
3. Check the audit log and provider usage for what was used.
4. If lead data was exposed, LGPD requires notifying the ANPD and the affected people within a reasonable time (ANPD guidance: 3 business days). Write down what happened.

## Sources

- LGPD (Lei 13.709/2018): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ANPD incident notification rule, Resolução CD/ANPD nº 15/2024 (3 business days): https://www.legisweb.com.br/legislacao/?id=458235
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Top 10 for LLM Applications: https://genai.owasp.org/llm-top-10/
- Meta webhooks and `X-Hub-Signature-256`: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- WhatsApp Cloud API pricing and customer service window: https://developers.facebook.com/docs/whatsapp/pricing
- Cloudflare Access JWT validation: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
- Google API key restrictions: https://cloud.google.com/docs/authentication/api-keys
