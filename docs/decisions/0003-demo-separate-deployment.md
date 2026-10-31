# ADR-0003: Public demo is a separate deployment with its own fake database

**Status:** Proposed
**Date:** 2026-10-31
**Deciders:** Diego

## Context
The spec requires a public, read-only demo mode that must never show real lead data. The obvious build is a `?demo=1` flag or a `/demo` route in the production app that swaps in fake data.

## Options considered

### A: Demo flag or route in the production app
**Pros:** one deployment.
**Cons:** the demo runs next to real data and real credentials. One bug in the switch (a shared query, a cached page, a missed route) leaks real leads to the public. Access must also be bypassed for a public path on the production hostname.

### B: Separate Worker and database (`demo.` hostname), same code, `ENVIRONMENT=demo`
**Pros:** there is no real data in reach, so a bug can't leak it. No outbound secrets are set, so nothing can be sent. Read-only is enforced twice: env validation rejects outbound keys, and a middleware rejects every POST.
**Cons:** a second deployment and a Neon branch or free database to keep seeded.

## Decision
Option B. The demo is seeded by `pnpm db:seed --demo` with a fixed random seed, and reseeded nightly by cron so it always looks fresh.

## Consequences
- The demo can't drift far from the real product, because it is the same build.
- `ENVIRONMENT=demo` becomes a fourth value in env validation. In demo, auth is `none` and POSTs are blocked. Outbound, WhatsApp and LLM keys must be absent or startup fails.
