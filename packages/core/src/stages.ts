export const STAGES = [
  "discovered",
  "audited",
  "scored",
  "draft_ready",
  "contacted",
  "replied",
  "qualified",
  "call_booked",
  "proposal_sent",
  "won",
  "lost",
  "opted_out",
] as const;

export type Stage = (typeof STAGES)[number];

export const LEAD_SOURCES = [
  "manual_csv",
  "manual_paste",
  "manual_form",
  "google_places",
  "cnpj",
  "instagram",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const SUPPRESSION_KINDS = ["email", "phone", "domain", "cnpj"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export const DEDUPE_RULES = ["domain_city_mismatch", "phone_name_mismatch", "fuzzy_name_city"] as const;
export type DedupeReviewRule = (typeof DEDUPE_RULES)[number];
