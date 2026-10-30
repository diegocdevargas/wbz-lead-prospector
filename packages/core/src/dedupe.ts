import type { AppConfig } from "./config.ts";
import type { NormalizedLead } from "./lead.ts";
import { similarity } from "./similarity.ts";
import type { DedupeReviewRule } from "./stages.ts";

/** The slice of an existing company that matching looks at. */
export interface ExistingCompany {
  id: string;
  matchName: string;
  cityNormalized: string | null;
}

export interface MatchCandidates {
  byDomain: ExistingCompany | null;
  byPhone: ExistingCompany | null;
  byCnpj: ExistingCompany | null;
  /** Same-city companies whose match name is at least `fuzzyThreshold` similar. */
  fuzzy: ExistingCompany[];
}

export type MatchDecision =
  | { kind: "create" }
  | { kind: "merge"; companyId: string; rule: "domain" | "phone" | "cnpj" }
  | {
      kind: "review";
      candidates: { companyId: string; rule: DedupeReviewRule; similarity: number | null }[];
    };

/**
 * Decide what an incoming lead is relative to existing companies.
 * Order follows the spec: domain, phone, CNPJ, then fuzzy name+city.
 * Exact hits merge, except the two ambiguous cases, which create the lead
 * and queue the pair for review rather than risk a wrong merge:
 *   - same domain but a different (known) city: likely another branch
 *   - same phone but dissimilar names: shared switchboards, reused numbers
 * Fuzzy matches never merge on their own.
 */
export function decideMatch(
  lead: Pick<NormalizedLead, "matchName" | "cityNormalized">,
  found: MatchCandidates,
  config: AppConfig,
): MatchDecision {
  if (found.byDomain) {
    const a = lead.cityNormalized;
    const b = found.byDomain.cityNormalized;
    if (a && b && a !== b) {
      return review(found.byDomain.id, "domain_city_mismatch", null);
    }
    return { kind: "merge", companyId: found.byDomain.id, rule: "domain" };
  }

  if (found.byPhone) {
    const score = similarity(lead.matchName, found.byPhone.matchName);
    if (score < config.dedupe.phoneNameMinSimilarity) {
      return review(found.byPhone.id, "phone_name_mismatch", score);
    }
    return { kind: "merge", companyId: found.byPhone.id, rule: "phone" };
  }

  if (found.byCnpj) return { kind: "merge", companyId: found.byCnpj.id, rule: "cnpj" };

  const fuzzy = found.fuzzy
    .filter((c) => c.cityNormalized && c.cityNormalized === lead.cityNormalized)
    .map((c) => ({ c, score: similarity(lead.matchName, c.matchName) }))
    .filter(({ score }) => score >= config.dedupe.fuzzyThreshold)
    .sort((x, y) => y.score - x.score);
  if (fuzzy.length > 0) {
    return {
      kind: "review",
      candidates: fuzzy.map(({ c, score }) => ({
        companyId: c.id,
        rule: "fuzzy_name_city" as const,
        similarity: score,
      })),
    };
  }

  return { kind: "create" };
}

function review(companyId: string, rule: DedupeReviewRule, score: number | null): MatchDecision {
  return { kind: "review", candidates: [{ companyId, rule, similarity: score }] };
}
