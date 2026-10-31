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
  "website_audit",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const SUPPRESSION_KINDS = ["email", "phone", "domain", "cnpj"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export const DEDUPE_RULES = ["domain_city_mismatch", "phone_name_mismatch", "fuzzy_name_city"] as const;
export type DedupeReviewRule = (typeof DEDUPE_RULES)[number];

/** Sources that can create a lead. `website_audit` only confirms fields of an existing one (field_sources). */
export const CREATING_SOURCES = LEAD_SOURCES.filter((s) => s !== "website_audit");

export const CAMPAIGN_STATUSES = ["draft", "running", "done", "stopped_budget"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const JOB_KINDS = ["discover_query", "audit_lead", "prune_expired"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** pending → running → succeeded | failed (will retry) → dead (gave up). */
export const JOB_STATUSES = ["pending", "running", "succeeded", "failed", "dead"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const AUDIT_STATUSES = ["ok", "no_website", "unreachable", "blocked"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const PLATFORMS = [
  "wordpress",
  "woocommerce",
  "wix",
  "shopify",
  "nuvemshop",
  "vtex",
  "linx",
  "tray",
  "loja_integrada",
  "squarespace",
  "custom",
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Platforms that mean "this business runs an online store". */
export const ECOMMERCE_PLATFORMS: readonly Platform[] = [
  "woocommerce",
  "shopify",
  "nuvemshop",
  "vtex",
  "linx",
  "tray",
  "loja_integrada",
];
