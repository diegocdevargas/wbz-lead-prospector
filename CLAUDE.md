# Webcraftz Prospector — Project Spec

You are a senior TypeScript engineer helping me build **Webcraftz Prospector**: a lead-generation and qualification system for my web/automation studio, Webcraftz (webcraftz.com.br). I'm a senior frontend/full-stack developer (13+ years: WordPress, WooCommerce, React/Next.js, TypeScript, Node, Cloudflare, Docker). Optimize for **code I can maintain alone**, low running cost, and legal compliance in Brazil (LGPD) and on every platform used.

### Goal
Find small and medium Brazilian businesses that would benefit from what I sell, detect concrete evidence they need it, draft personalized outreach that I approve before sending, and when a lead replies on WhatsApp, qualify them and book a call on my calendar.

**What I sell (use this to score fit):**
1. Websites and landing pages (WordPress or Next.js), redesigns, performance/SEO fixes
2. E-commerce (WooCommerce, platform migrations, store fixes)
3. AI automation: WhatsApp/Instagram service bots, lead qualification, scheduling bots, integrations (n8n, CRMs, Google Calendar)

### Non-negotiable rules (compliance + account safety)
- **No scraping of LinkedIn or Instagram**, no headless-browser automation of either, and no fake accounts. Both platforms ban accounts for this. Use LinkedIn only through leads I add by hand (CSV/paste/form). Use Instagram only through the official **Instagram Graph API Business Discovery** endpoint, for public business/creator profiles.
- **No cold WhatsApp messages.** The WhatsApp Cloud API is used only when the lead starts the conversation, typically via a `wa.me` click-to-chat link in my email or DM, or after explicit opt-in. Never send marketing templates to numbers that did not opt in.
- **Human in the loop for all outbound.** The system drafts; I approve, edit, or reject. Nothing goes out automatically on first contact.
- **LGPD:** prospect businesses, not private individuals. Store only business contact data (company email/phone/site/profile), record the data source and date for every field, honor opt-out immediately and permanently (suppression list checked before every draft), and let me export or delete any lead's data.
- **Email:** low volume (start at 20/day max), sent from a subdomain (e.g. `contato@mail.webcraftz.com.br`) with SPF/DKIM/DMARC, plain text, one-click opt-out line in every email.
- Respect every API's rate limits and terms; cache responses to save quota.

### Stack
- **Runtime:** Node 22 + TypeScript (strict), pnpm, single repo.
- **API/worker:** Hono. Deployable to Cloudflare Workers (queues + cron triggers), with a Node fallback for local dev.
- **DB:** Postgres (Neon or Supabase) via Drizzle ORM. If you think Cloudflare D1 is enough, say why and let me choose.
- **Queue/jobs:** Cloudflare Queues (prod), in-memory adapter (dev). All jobs idempotent and retry-safe.
- **LLM:** Anthropic Claude API with tool use. `claude-haiku-5-5` for bulk work (classification, scoring, summarizing audits); `claude-sonnet-5-5` for outreach drafts and the live WhatsApp agent. Put model names in config, never hardcoded. Use prompt caching for the system prompts.
- **Validation:** Zod for every external input and every LLM structured output (retry once on schema failure, then flag for manual review).
- **Dashboard:** a small Next.js admin (or a single Hono-rendered page if simpler) behind auth.
- **Tests:** Vitest for scoring, dedupe, and suppression logic; recorded fixtures for external APIs.

### Modules

**1. Discovery (finding businesses)**
Sources, in priority order:
- **Google Places API (New) — Text Search:** queries like `"clínica odontológica em Passo Fundo"`. Store name, address, phone, website, rating, review count, Maps URL, place_id. A campaign is a `niche × city list` (I configure it in the dashboard).
- **Receita Federal open CNPJ data:** import the public dataset filtered by CNAE codes and municipalities I choose. Gives company age, size (porte), CNAE, and sometimes email/phone. Use it to enrich and to find businesses that Google lists poorly.
- **Instagram Graph API — Business Discovery:** given a handle (found on the company website or added by me), fetch bio, followers, media count, website link, and recent posting frequency.
- **Manual import:** CSV/paste/form for leads I find on LinkedIn, Workana, referrals, or events. Fields: name, company, role, URL, notes.

Dedupe across sources by normalized domain → phone (E.164) → CNPJ → fuzzy name+city.

**2. Enrichment and website audit (the core differentiator)**
For each lead with a website, run an automated audit and store the raw results:
- **PageSpeed Insights API** (free): mobile performance score, LCP, CLS, INP.
- **HTML checks** (fetch + parse): HTTPS/valid SSL, viewport meta, title/meta description present, H1 count, broken internal links (sample of 20), WhatsApp button or link present, online booking present (look for Calendly, Doctoralia, Agendor, Google booking, etc.), contact form present, copyright year in footer, detected platform (WordPress, Wix, Shopify, Nuvemshop, WooCommerce, VTEX, Linx, custom), detected chat widget.
- **No website at all** → strong signal for the website offer.
- **Instagram signals:** active profile + weak or missing site = strong fit; link-in-bio pointing to Linktree only = good fit.
- **Google reviews signals:** many reviews mentioning "demora para responder" / "não atendem o WhatsApp" / "difícil agendar" → strong fit for the bot offer. Summarize review text with Haiku. Do not store reviewer names.

Turn the audit into a short list of **human-readable findings** in Portuguese, each with evidence, e.g. "Site leva 9,2s para carregar no celular (PageSpeed 23/100)". These findings feed the outreach.

**3. Scoring**
Two scores, 0–100 each, with the reasoning stored:
- **Fit score:** how much they need what I sell, based on audit findings, niche, platform, and signals.
- **Ability-to-pay score:** reviews volume, rating, company size (porte), number of locations, ads presence if detectable, niche ticket size.
Final priority = weighted combination (weights configurable). Rules first, LLM second: compute deterministic points in code, then let Haiku adjust ±15 with a written justification. Tiers: A (contact this week), B (nurture), C (skip).

**4. Outreach drafting (human approves)**
- For tier A/B leads, Sonnet drafts a first message per channel: email, Instagram DM text (I send manually), LinkedIn note (I send manually; ≤300 chars).
- Every draft must cite 1–2 **specific** audit findings, offer one concrete, free, small thing (e.g. "posso te mandar um vídeo de 2 min mostrando os 3 ajustes que mais aumentariam seus agendamentos"), and include a `wa.me` link with a prefilled message containing a tracking code (e.g. `Oi! Vim pelo e-mail da Webcraftz [ref:A7K2]`), so the WhatsApp agent knows who they are when they write.
- Follow-up sequence: up to 2 follow-ups (day 4, day 10), each adding new value instead of "just checking in". Stop on reply, bounce, or opt-out.
- Approval queue in the dashboard: approve, edit-then-approve, regenerate with my note, or reject with reason (rejections are logged to improve prompts).

**5. WhatsApp qualifier agent (inbound)**
- Cloud API webhook: verify `X-Hub-Signature-256`, return 200 immediately, enqueue processing, dedupe by message id.
- Match the `[ref:XXXX]` code (or phone) to an existing lead and load their audit findings as context.
- Run the agent (Part 2 prompt) with tools:
  - `get_lead_context(lead_id)`
  - `update_qualification(lead_id, fields)` (budget range, timeline, decision maker, main pain, service interest)
  - `get_available_slots(range)` and `book_call(slot, lead_id)` (Google Calendar API or Cal.com API, my choice in config)
  - `send_portfolio_item(service_type)` (curated real cases only, from a config list)
  - `handoff_to_human(reason)` (pauses the bot for that thread and notifies me)
  - `mark_opt_out(lead_id)`
- Use interactive buttons/lists for structured choices (service type, budget range, time slots); free text for everything else.
- Respect the 24h customer service window; outside it, only approved utility templates for confirmed bookings and reminders.
- Send meeting reminders 24h and 1h before (utility template), with a reschedule option.

**6. CRM pipeline and notifications**
Stages: `discovered → audited → scored → draft_ready → contacted → replied → qualified → call_booked → proposal_sent → won / lost / opted_out`. Every transition is logged with timestamp and actor (system or me).
Notify me (Telegram bot or email, configurable) on: new reply, qualified lead, call booked, human handoff requested.
Daily digest at 8:00 America/Sao_Paulo: new A-tier leads, drafts awaiting approval, replies, today's calls.

**7. Dashboard**
- Campaigns: create niche × cities, trigger discovery, see counts and costs.
- Lead list with filters (tier, stage, niche, city, platform) and a lead page: audit findings, scores with reasoning, timeline, conversation transcript, drafts.
- Approval queue (keyboard shortcuts: A approve, E edit, R reject).
- Metrics: reply rate by niche/channel/message variant, cost per qualified lead, calls booked per week.
- **Public demo mode:** a sanitized, read-only view with fake data that I can embed in my portfolio to show prospective clients how the system works. It must never show real lead data, so it runs as a separate deployment with its own fake database (ADR-0003).
- Also: Today (home, same data as the digest), Outbox, Conversations inbox with bot take-over, Calls, Usage and costs, Jobs, read-only Settings.
- **Assistant:** a chat panel for me that answers from the data and proposes actions I confirm. Read-only tools, never sends outbound. Built in steps M3 → M5: `docs/assistant.md`.
- **Gamification** (M6, details from me later): points derived from the audit log and `stage_events`, rewarding outcomes, not send volume.
- Built server-rendered in the Hono app (ADR-0001). **Each milestone ships the screens for its own module**; the full screen list, milestone per screen and UI rules are in `docs/dashboard.md`.

**8. Cost and safety guards**
- Per-campaign budget caps for Google Places and Claude API; stop and notify when reached.
- Log tokens and cost per LLM call.
- Secrets only in environment variables; never log message bodies at info level; mask phones/emails in logs.
- Outbound kill switch (`OUTBOUND_ENABLED`), and the suppression check and daily cap are re-checked at send time, not only at draft time.
- Full security baseline (public routes, webhook signatures, SSRF rules for the audit fetcher, prompt-injection handling, audit log, data retention): `docs/security.md`. It applies to every milestone.

### How to work
1. Before writing code, give me a short plan: folder structure, DB schema (tables + key columns), and the order of milestones. Ask about anything ambiguous. **Wait for my OK.**
2. Build in milestones, each runnable and tested:
   - M1 ✅: schema, manual import, dedupe, dashboard lead list
   - M2: Google Places discovery + website audit + findings. Dashboard: app shell v2, Campaigns, Audit tab, Jobs, Settings
   - M3: scoring + approval queue + email drafting/sending with opt-out. Dashboard: Approval queue, Outbox, Usage and costs, Today, Assistant (read-only)
   - M4: WhatsApp webhook + qualifier agent + calendar booking. Dashboard: Conversations, Calls, notification settings, Assistant proposals and streaming
   - M5: Instagram Business Discovery, CNPJ import, follow-ups, digest, metrics, demo mode. Dashboard: Metrics, public demo, Assistant insights
   - M6: gamification (details pending)
3. After each milestone: what works, how to run it, what's next, and any decision I need to make.
4. Prefer boring, well-documented libraries. Don't add dependencies without saying why.
5. **Workflow:** one branch and PR per milestone (or smaller), from the latest `main`. CI green (lint, typecheck, migrations check, tests, audit) and my review before merge. Run the `security-review` skill on the diff before asking for review. Conventional, descriptive commit messages.
6. **Decisions** that change the stack, data model or a rule go in `docs/decisions/NNNN-title.md` (short ADR: context, options, decision, consequences) and are linked from here.
7. **Keep it reusable** (it may become a portfolio piece and a product for other clients): no Webcraftz-specific values in code, offer and brand injected into prompts from config, scoring rules as data. One isolated instance per client, never multi-tenant (ADR-0002). Details and what is deliberately left out: `docs/productization.md`.

### Source of truth
One place per kind of fact. When two disagree, the one listed here wins and the other gets fixed in the same PR.

| Fact | Source of truth |
| --- | --- |
| What to build, rules, milestones | This file (`CLAUDE.md`) |
| Why a choice was made | `docs/decisions/` |
| Dashboard, assistant, security, productization plans | `docs/dashboard.md`, `docs/assistant.md`, `docs/security.md`, `docs/productization.md` |
| How to run, deploy, env vars | `README.md` |
| Data model | `packages/db/src/schema.ts`; migrations are generated from it, never hand-edited after merge |
| Enums (stages, sources) | `packages/core/src/stages.ts`, which the DB enums import |
| Tunables (models, weights, thresholds, caps) | `packages/core/src/config.ts`, overridden only by `APP_CONFIG` |
| LLM prompts | `prompts/` |
| A lead's current stage | `stage_events` (append-only); `stage` on the lead is a cache of the latest event |
| Code | `main` on GitHub. Chat, project memory and notes are not a source of truth |

## Runtime prompts
The agent and LLM prompts live in `/prompts` (whatsapp-agent.md, outreach-draft.md, scoring.md). Load them from there; don't inline them in code.
