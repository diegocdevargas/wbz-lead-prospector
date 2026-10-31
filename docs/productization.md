# Portfolio piece and future product

Later, the Prospector should do two more jobs: be a **portfolio piece** that shows prospective clients how it works, and be **sold to other businesses** to prospect for their own offers. Neither is built now. This file lists the cheap habits that keep both options open, and the work deliberately left out until there is a paying client.

Decision: [ADR-0002](decisions/0002-single-tenant-per-client.md). Each client gets its own isolated instance (Worker plus database). There is no multi-tenant database.

## Habits from now on (cheap, every milestone)

1. **No Webcraftz-specific values in code.** Brand name, sender name and address, `wa.me` number, booking provider, offer catalog, portfolio cases and niche ticket sizes live in config (`packages/core/src/config.ts` defaults, overridable per instance). A new client instance should differ only in config, prompts and secrets.
2. **Prompts take the offer as input.** `prompts/*.md` describe how to do the job. What is being sold (services, proof, tone) is injected from config, so another client's offer doesn't need a prompt fork.
3. **Scoring rules are data.** Rule points and weights per niche and offer live in config, not in `if` chains, so they can be changed per client.
4. **Generic actor names.** The `actor` enum value `diego` becomes `user` (one-line `ALTER TYPE ... RENAME VALUE` migration in M2), and the UI shows the configured operator name.
5. **Everything an instance needs is in the repo.** Migrations, `wrangler.toml` with no hardcoded IDs (use env), `.env.example`, a seed script and the README deploy steps. Standing up an instance is a checklist, not tribal knowledge.
6. **Demo data generator** (`pnpm db:seed`) grows with each milestone. It already exists for M1. It feeds tests, screenshots and the public demo.

## The portfolio piece (M5)

- Public demo per [ADR-0003](decisions/0003-demo-separate-deployment.md): its own Worker and database, seeded fake data, read-only, no outbound secrets.
- A short case-study page on webcraftz.com.br that embeds the demo: problem, approach (rules first, LLM second; human in the loop; LGPD), screenshots and metrics. Use real aggregate numbers only if Diego chooses to publish them.
- The repo stays private. The demo shows the product, not the code.

## Path to SaaS (one product, in stages)

The Prospector itself is the SaaS candidate. A separate product would split a solo developer's time before either one has proof.

1. **Own use and portfolio (M1–M6).** It prospects for Webcraftz. Real results (replies, calls, contracts) become the case study, and the public demo shows the product.
2. **Managed instances (1–3 pilots).** Offer setup plus a monthly fee to businesses that sell services to SMBs, starting with agencies and freelancers like Webcraftz. Each pilot gets its own instance ([ADR-0002](decisions/0002-single-tenant-per-client.md)). This tests willingness to pay with no billing or signup code.
3. **Self-serve SaaS** only if the pilots renew and there are about 10 paying instances. Then revisit ADR-0002 (multi-tenant, billing, onboarding).

Don't start a second product until stage 2 shows whether this one sells.

## Selling it to clients (later, when a client signs)

What changes then:

- **LGPD roles.** For a client's instance, the client is the controller and Webcraftz is the processor. That needs a DPA (contrato de tratamento de dados), and the client owns their opt-out list, sending domain and WhatsApp number.
- **Their accounts, their keys.** Each client uses their own Google, Anthropic and Meta accounts and email subdomain. Costs and bans stay isolated, and Meta's terms require the business itself to own the WhatsApp number.
- **Operations:** one GitHub release tag deployed to all instances, migrations run per instance, and a per-instance health check.

Left out on purpose (noise until then): multi-tenancy, billing, signup and onboarding, role-based permissions, white-label theming and a public API.
