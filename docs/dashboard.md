# Dashboard plan

The dashboard is where every human step happens: configuring campaigns, approving outbound, taking over conversations, and deleting or exporting data. It is not a separate project. **Each milestone ships the screens for its own module**, because a module that has no screen can't be operated or tested by hand. A screen built before its data exists is guesswork.

Stack decision: [ADR-0001](decisions/0001-server-rendered-dashboard.md) (server-rendered Hono JSX, no Next.js).

## Principles

- **Server-rendered, works without JavaScript.** Plain HTML forms and links. One small external `/assets/app.js` (no framework, no inline scripts, so the strict CSP stays) adds only keyboard shortcuts, confirm dialogs, and auto-submitting filters.
- **Every page is a URL.** Filters, sorting and pagination live in the query string, so a view can be bookmarked and the back button works. Pagination is keyset (cursor), not offset.
- **Show the evidence.** Scores, findings and drafts always show why: the reasoning, the source, and the date.
- **Dangerous actions are POST + confirm**, and they are logged to `stage_events` or the audit log with the actor.
- **Display in `America/Sao_Paulo`, store in UTC.** Numbers and dates are formatted pt-BR. UI labels stay in English for now. Outreach and findings are in Portuguese, as the spec already says.
- **Accessible by default:** real `<label>`s, visible focus, tables with `<th scope>`, contrast AA. Shortcuts never fire while typing in an input.
- **Charts are inline SVG rendered on the server** (bars and sparklines). No chart library.
- **No PII in URLs**, so emails and phones never appear in a query string, access log or browser history. Search with a POST, or by id.

## Screens by milestone

| Screen | What it does | Milestone |
| --- | --- | --- |
| Leads list | Filters, stage, source | M1 ✅ |
| Lead page | Fields with sources, timeline, stage change, export, delete | M1 ✅ |
| Import, Duplicates, Opt-outs | CSV, paste, form, dedupe review, suppression list | M1 ✅ |
| **App shell v2** | Grouped nav, shared filter bar, table, pager, empty states, flash messages. `app.js` shell for shortcuts | M2 ✅ |
| **Campaigns** | Create niche × city list, run discovery, see progress, counts, and Places spend against the cap | M2 ✅ |
| **Lead page: Audit tab** | Findings in PT with evidence, PageSpeed numbers, detected platform, raw audit (collapsed), re-run | M2 ✅ |
| Leads list filters | Niche, city, platform, has website | M2 ✅ |
| **Jobs** | Queue runs: pending, failed, retried, dead-lettered, with a retry button | M2 ✅ |
| **Settings (read-only)** | Effective config (models, weights, caps, thresholds) with secrets shown as set or missing, never as values | M2 ✅ |
| Lead page: Scores | Fit and ability-to-pay scores, rule points, the LLM adjustment and its justification, tier | M3 |
| Leads list | Tier filter, sort by priority | M3 |
| **Approval queue** | One draft at a time with lead context. `A` approve, `E` edit, `R` reject with reason, `G` regenerate with note, `J`/`K` next/previous | M3 |
| **Outbox** | Sent emails, status (sent, bounced, opted out), daily send count against the 20/day limit | M3 |
| **Usage and costs** | LLM tokens and cost per call, campaign, and day, plus budget caps and how much is left | M3 |
| **Today** (home) | New A-tier leads, drafts waiting, replies, today's calls. Same data as the 8:00 digest | M3 (extended in M4) |
| **Conversations** | WhatsApp inbox: transcript, bot active or paused, handoff reason, take over or resume the bot, 24h window countdown | M4 |
| Lead page: Qualification | Budget, timeline, decision maker, pain, interest, booked call | M4 |
| **Calls** | Upcoming and past calls, reschedule link, outcome (proposal, won, lost) | M4 |
| Notifications settings | Telegram or email, which events | M4 |
| Instagram and CNPJ import | Add handles, choose CNAE codes and municipalities, see import runs | M5 |
| Lead page: Follow-ups | Sequence state, next send date, stop reason | M5 |
| **Metrics** | Reply rate by niche, channel and variant; cost per qualified lead; calls per week; funnel by stage | M5 |
| **Public demo** | Read-only, fake data, separate deployment ([ADR-0003](decisions/0003-demo-separate-deployment.md)) | M5 |
| **Assistant** | Chat panel that answers from the data and proposes actions you confirm. Steps in [assistant.md](assistant.md) | M3 → M5 |
| **Gamification** | Placeholder, see below | M6 |

## Navigation

```
Today
Prospecting:  Campaigns · Leads · Import · Duplicates
Outreach:     Approval queue · Outbox
Inbound:      Conversations · Calls
Insights:     Metrics · Usage and costs · Assistant
System:       Jobs · Opt-outs · Settings
```

Sections appear when their milestone ships. There are no placeholder links.

## Gamification (placeholder)

Diego will send the details later. The idea: the operator levels up by using the platform. It is planned as **M6**, after Metrics, because it needs action history and outcome data to score anything.

What earlier milestones already provide, so M6 is mostly UI and rules:
- The append-only **audit log** (M3) and `stage_events` record every action with its actor and time. Points are computed from these events, never stored as a separate truth.
- Point rules go in config, like the scoring rules, so they can change without a migration.

Guardrail for when we design it: reward outcomes and good habits (reviewing a draft carefully, replies, calls booked, opt-outs honored), never raw volume of sends. Volume rewards would push against the 20/day email cap and the human-in-the-loop rule.

## Definition of done for a screen

- Route handlers validate every query and form input with Zod.
- An integration test covers render, the main action, and the auth requirement.
- Empty, loading (for long jobs: status plus refresh) and error states exist.
- No real lead data in fixtures or screenshots. Use `.test` domains and fake numbers.
