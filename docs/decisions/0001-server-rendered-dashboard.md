# ADR-0001: Server-rendered dashboard in the Hono app

**Status:** Proposed (M1 already follows it)
**Date:** 2026-10-31
**Deciders:** Diego

## Context
The spec allows "a small Next.js admin, or a single Hono-rendered page if simpler". M1 shipped Hono JSX pages with plain forms, a strict CSP and Cloudflare Access. The full dashboard (see [dashboard.md](../dashboard.md)) has about 15 screens. Most are tables, forms and one keyboard-driven approval queue. There is one user.

## Options considered

### A: Keep Hono JSX, server-rendered, plus one small `app.js`
| Dimension | Assessment |
| --- | --- |
| Complexity | Low: one app, one deploy, one auth path |
| Cost | Same Worker, no extra hosting |
| Security | Strict CSP without exceptions, no client-side API to secure |
| Familiarity | JSX and TypeScript, which Diego knows |

**Pros:** data access and validation stay in one place, no API layer to duplicate, no build step for the UI, fast on any device.
**Cons:** rich interactions (live updates, drag and drop) cost more. Each form round-trips.

### B: Next.js admin app calling the Hono API
| Dimension | Assessment |
| --- | --- |
| Complexity | Medium–high: second app, an API contract, two auth checks, two deploys |
| Cost | Second deployment (Vercel, or OpenNext on Workers) |
| Security | CSP needs Next's nonces. API endpoints become a second attack surface |
| Familiarity | High |

**Pros:** a richer UI toolkit, and it is Diego's portfolio stack.
**Cons:** roughly twice the surface to maintain alone, for screens that are mostly tables.

### C: Hono plus htmx
Partial updates without a SPA, but it adds a dependency and its CSP needs care. M1 already chose not to use it.

## Decision
Option A. Add a small vanilla `app.js` only for keyboard shortcuts and confirms.

## Consequences
- Easier: one codebase, the same tests cover UI and logic, and the security model stays simple.
- Harder: a polished, interactive public demo. That's fine: the demo is read-only, and its look can be improved with CSS.
- Revisit if a screen needs real-time updates (the Conversations inbox in M4 could use a meta refresh or SSE first) or if a paying client needs a richer UI.
