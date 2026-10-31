# ADR-0004: Keep only place_id from Google Places indefinitely

**Status:** Accepted (Diego, 2026-10-31)
**Date:** 2026-10-31
**Deciders:** Diego

## Context
Discovery uses Google Places API (New). Google's Maps Platform terms let us keep the `place_id` indefinitely but restrict storing other Places content (name, phone, website, address, rating, reviews). A lead database that keeps everything Places returns forever would break those terms, and the spec requires respecting every API's terms.

## Options considered

### A: Keep everything Places returns
**Pros:** simplest. **Cons:** breaks the terms; risks the Google account and key.

### B: Keep only place_id, re-fetch everything on use
**Pros:** clean with the terms. **Cons:** a paid Place Details call every time a lead is shown or scored; the lead list would have no names.

### C: place_id forever; other Places values expire after 30 days unless another source confirms them
**Pros:** follows the terms for data we only have from Google. The audit confirms the name, phone and website on the business's own site, so most useful leads keep their data. **Cons:** a daily prune job; unconfirmed phones and sites disappear after 30 days.

## Decision
Option C.
- Places values are written to `field_sources` with `expires_at` = collected + `places.contentTtlDays` (30).
- The audit writes `website_audit` sources for what the site itself shows (name, phone, website, Instagram handle). CNPJ and manual imports also count.
- The daily `prune_expired` job deletes expired Places sources and clears the company column when no other source backs it: phone, website (and domain), address, Maps URL, rating, review count.
- Review text is never stored: the audit counts pain phrases in memory and keeps only the counts.
- City, state and niche are not treated as Places content: they come from the campaign Diego configured.
- **Name is kept** as the lead's identifier even when unconfirmed. If that is too lenient, the alternative is deleting unconfirmed leads after 30 days (keeping place_id in a seen-list).

## Consequences
- Leads in outreach should be audited within 30 days of discovery, which the pipeline does automatically.
- Re-running an old campaign refreshes Places values (known place_ids are refreshed, not duplicated).
