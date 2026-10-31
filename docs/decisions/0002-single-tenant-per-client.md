# ADR-0002: One isolated instance per client, not multi-tenant

**Status:** Proposed
**Date:** 2026-10-31
**Deciders:** Diego

## Context
The Prospector may later be sold to other businesses to prospect for their own offers. Planning for that now could mean adding a `tenant_id` to every table and query. Today there is one user, and there might be a handful of clients later. Each client's lead data is personal data under LGPD, where that client is the controller.

## Options considered

### A: Single-tenant code, one deployment and one database per client
**Pros:** no tenant filters to forget, so one client can never see another's data. Each client's costs, keys, sending reputation and bans stay isolated. Easy to delete a whole client. No change to today's code.
**Cons:** N deployments to update. Mitigated by one release tag, a deploy script and per-instance migrations.

### B: Shared database with `tenant_id` and row-level security
**Pros:** one deploy, and cheap at large scale.
**Cons:** every query, index, test and job carries a tenant. One missed filter is a data leak. Shared sending infrastructure means one client's complaints hurt everyone. It's overkill for fewer than about 20 clients.

## Decision
Option A. Keep the code single-tenant and make everything client-specific config, following the habits in [productization.md](../productization.md).

## Consequences
- Easier: LGPD processor role per client, isolation, and today's development speed.
- Harder: fleet operations once there are many instances.
- Revisit at around 10 or more paying instances, or if clients ask for self-serve signup.
