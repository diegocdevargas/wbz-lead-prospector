# ADR-0006: Lead groups for branches of the same business

**Status:** Accepted (Diego, 2026-11-01)
**Date:** 2026-11-01
**Deciders:** Diego

## Context
Google Places lists each unit of a business separately. Dedupe sends "same domain, different city" and similar pairs to review, where the only choices were *merge* (lose one unit's address, phone and reviews) or *not a duplicate* (two unrelated leads). Neither fits a clinic with three branches. Left as separate leads, M3 would draft three outreach messages to the same owner, and an opt-out from one unit would not stop the others.

## Options considered

### A: Merge branches into one lead
**Pros:** nothing new. **Cons:** loses per-unit data (address, phone, Maps, reviews, audit); a wrong merge cannot be undone.

### B: A separate `organizations` table with leads as members
**Pros:** room for org-level data later. **Cons:** a new table, joins everywhere, and an empty org row for every single-unit lead (most of them).

### C: `companies.group_id` pointing at the group's main lead (one level)
**Pros:** one nullable column; every lead keeps its own data; easy to undo. **Cons:** org-level data, if ever needed, lives on the main lead.

## Decision
Option C. On the Duplicates screen, **Same group (branch)** sets the second lead's `group_id` to the first lead's group (its main lead). Groups are one level deep: a branch's branches are repointed to the main lead, and a check stops a lead from pointing at itself. Merging a main lead moves its branches to the kept lead. A branch can be removed from its group, and a main lead can dissolve its group, from the lead page. Every change is logged on the timeline. The pair is stored with status `grouped`.

## Consequences
- M3 drafts outreach **only for the main lead** of a group; the draft may mention every unit. Branches skip drafting.
- An opt-out from any unit applies to the whole group (M3 suppression check walks the group).
- Each unit keeps its own audit and findings; M3 scoring can use the group size as an ability-to-pay signal (number of locations, already in the spec).
- Retention (ADR-0004) and LGPD export/delete stay per lead; deleting a main lead frees its branches (`on delete set null`).
