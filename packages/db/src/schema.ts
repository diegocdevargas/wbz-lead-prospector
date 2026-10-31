import {
  AUDIT_STATUSES,
  CAMPAIGN_STATUSES,
  DEDUPE_RULES,
  JOB_KINDS,
  JOB_STATUSES,
  LEAD_SOURCES,
  PLATFORMS,
  STAGES,
  SUPPRESSION_KINDS,
} from "@wbz/core";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const stageEnum = pgEnum("stage", STAGES);
export const leadSourceEnum = pgEnum("lead_source", LEAD_SOURCES);
export const suppressionKindEnum = pgEnum("suppression_kind", SUPPRESSION_KINDS);
export const dedupeRuleEnum = pgEnum("dedupe_rule", DEDUPE_RULES);
export const dedupeStatusEnum = pgEnum("dedupe_status", ["pending", "dismissed"]);
export const actorEnum = pgEnum("actor", ["system", "diego"]);
export const campaignStatusEnum = pgEnum("campaign_status", CAMPAIGN_STATUSES);
export const jobKindEnum = pgEnum("job_kind", JOB_KINDS);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const auditStatusEnum = pgEnum("audit_status", AUDIT_STATUSES);
export const platformEnum = pgEnum("platform", PLATFORMS);
export const importOutcomeEnum = pgEnum("import_outcome", ["created", "merged", "review", "suppressed", "invalid"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    /** normalized_name minus niche words; what fuzzy matching compares. */
    matchName: text("match_name").notNull(),
    city: text("city"),
    cityNormalized: text("city_normalized"),
    state: text("state"),
    cnpj: text("cnpj"),
    domain: text("domain"),
    websiteUrl: text("website_url"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    instagramHandle: text("instagram_handle"),
    niche: text("niche"),
    notes: text("notes"),
    /** Google place id: the only Places value the terms let us keep indefinitely. */
    placeId: text("place_id"),
    // Places content below expires after config.places.contentTtlDays (see prune job).
    address: text("address"),
    mapsUrl: text("maps_url"),
    googleRating: real("google_rating"),
    googleReviewCount: integer("google_review_count"),
    placesFetchedAt: timestamp("places_fetched_at", { withTimezone: true }),
    /** Cache of the latest audit, for list filters. */
    platform: platformEnum("platform"),
    lastAuditedAt: timestamp("last_audited_at", { withTimezone: true }),
    stage: stageEnum("stage").notNull().default("discovered"),
    source: leadSourceEnum("source").notNull(),
    ...timestamps,
  },
  (t) => [
    // Not unique: branches of one business can share a domain (see domain_city_mismatch).
    index("companies_domain_idx").on(t.domain),
    uniqueIndex("companies_cnpj_key").on(t.cnpj),
    index("companies_phone_idx").on(t.phoneE164),
    index("companies_city_idx").on(t.cityNormalized),
    index("companies_stage_idx").on(t.stage),
    uniqueIndex("companies_place_id_key").on(t.placeId),
    index("companies_created_idx").on(t.createdAt, t.id),
    index("companies_match_name_trgm_idx").using("gin", sql`${t.matchName} gin_trgm_ops`),
    check("companies_cnpj_format", sql`${t.cnpj} ~ '^[0-9]{14}$'`),
    check("companies_state_format", sql`${t.state} ~ '^[A-Z]{2}$'`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
    email: text("email"),
    phoneE164: text("phone_e164"),
    linkedinUrl: text("linkedin_url"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("contacts_company_idx").on(t.companyId)],
);

/** Where and when every stored value came from (LGPD). One row per field per observation. */
export const fieldSources = pgTable(
  "field_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["company", "contact"] }).notNull(),
    entityId: uuid("entity_id").notNull(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    source: leadSourceEnum("source").notNull(),
    /** e.g. the import id, a Places place_id, a CNPJ dataset date. */
    sourceRef: text("source_ref"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    /** When a provider's terms limit how long we may keep the value (Google Places: 30 days). Null = no limit. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("field_sources_company_idx").on(t.companyId), index("field_sources_expires_idx").on(t.expiresAt)],
);

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: leadSourceEnum("source").notNull(),
    filename: text("filename"),
    fileHash: text("file_hash").notNull(),
    rowCount: integer("row_count").notNull(),
    created: integer("created").notNull().default(0),
    merged: integer("merged").notNull().default(0),
    review: integer("review").notNull().default(0),
    suppressed: integer("suppressed").notNull().default(0),
    invalid: integer("invalid").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("imports_file_hash_idx").on(t.fileHash)],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    /** The row as received. Null for suppressed rows (we keep no data on opted-out contacts). */
    raw: jsonb("raw").$type<Record<string, string>>(),
    outcome: importOutcomeEnum("outcome").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    messages: jsonb("messages").$type<string[]>().notNull().default([]),
  },
  (t) => [index("import_rows_import_idx").on(t.importId), index("import_rows_company_idx").on(t.companyId)],
);

/** A pending "is B a duplicate of A?" question. Merging deletes B, and the pair with it; the merge is logged in stage_events. */
export const dedupeCandidates = pgTable(
  "dedupe_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The existing company. */
    companyA: uuid("company_a")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** The newly created company that may duplicate it. */
    companyB: uuid("company_b")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    rule: dedupeRuleEnum("rule").notNull(),
    similarity: real("similarity"),
    status: dedupeStatusEnum("status").notNull().default("pending"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dedupe_candidates_pair_key").on(t.companyA, t.companyB),
    index("dedupe_candidates_status_idx").on(t.status),
    check("dedupe_candidates_distinct", sql`${t.companyA} <> ${t.companyB}`),
  ],
);

export const suppressions = pgTable("suppressions", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: suppressionKindEnum("kind").notNull(),
  /** HMAC-SHA256 of "kind:normalized value"; the value itself is never stored. */
  valueHash: text("value_hash").notNull().unique(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stageEvents = pgTable(
  "stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fromStage: stageEnum("from_stage"),
    toStage: stageEnum("to_stage").notNull(),
    actor: actorEnum("actor").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stage_events_company_idx").on(t.companyId, t.createdAt)],
);

/** A niche × city list. Discovery runs one Text Search query per city (up to N pages each). */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    niche: text("niche").notNull(),
    /** "{niche} em {city}" by default. */
    queryTemplate: text("query_template").notNull(),
    cities: jsonb("cities").$type<string[]>().notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    /** Budget cap: Places requests (Text Search pages + Place Details) this campaign may make. */
    placesRequestCap: integer("places_request_cap").notNull(),
    placesRequestsUsed: integer("places_requests_used").notNull().default(0),
    /** Estimated list-price spend in USD (free monthly usage not subtracted). */
    estCostUsd: real("est_cost_usd").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check("campaigns_cap_positive", sql`${t.placesRequestCap} > 0`),
    check("campaigns_used_within_cap", sql`${t.placesRequestsUsed} <= ${t.placesRequestCap}`),
  ],
);

/** One Text Search page for one city of a campaign. Unique, so re-running a campaign never double-bills a page. */
export const discoveryQueries = pgTable(
  "discovery_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    city: text("city").notNull(),
    query: text("query").notNull(),
    page: integer("page").notNull(),
    /** Token from the previous page's response; null for page 1. */
    pageToken: text("page_token"),
    status: text("status", { enum: ["pending", "done", "skipped_budget", "failed"] })
      .notNull()
      .default("pending"),
    resultCount: integer("result_count"),
    created: integer("created").notNull().default(0),
    merged: integer("merged").notNull().default(0),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("discovery_queries_page_key").on(t.campaignId, t.city, t.page)],
);

export const campaignCompanies = pgTable(
  "campaign_companies",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_companies_key").on(t.campaignId, t.companyId),
    index("campaign_companies_company_idx").on(t.companyId),
  ],
);

/**
 * Background work. The table is the source of truth (status, attempts,
 * errors, retries); the queue only carries job ids. `idempotency_key` makes
 * enqueueing the same work twice a no-op.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: jobKindEnum("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Error class and message only; never request or response bodies. */
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("jobs_idempotency_key").on(t.idempotencyKey),
    index("jobs_status_run_after_idx").on(t.status, t.runAfter),
    index("jobs_created_idx").on(t.createdAt, t.id),
  ],
);

/** Cached external API responses, to save quota. Pruned when expired. */
export const apiCache = pgTable(
  "api_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider", { enum: ["places_text_search", "places_details", "pagespeed"] }).notNull(),
    keyHash: text("key_hash").notNull(),
    response: jsonb("response").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("api_cache_key").on(t.provider, t.keyHash), index("api_cache_expires_idx").on(t.expiresAt)],
);

/** One website audit run. Raw parts (`raw`) are deleted after config.audit.rawRetentionDays. */
export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: auditStatusEnum("status").notNull(),
    url: text("url"),
    finalUrl: text("final_url"),
    error: text("error"),
    platform: platformEnum("platform"),
    httpStatus: integer("http_status"),
    pagespeed: jsonb("pagespeed").$type<Record<string, unknown>>(),
    htmlChecks: jsonb("html_checks").$type<Record<string, unknown>>(),
    brokenLinks: jsonb("broken_links").$type<{ checked: number; broken: string[] }>(),
    /** Pain-phrase counts from Google reviews (no review text, no names). */
    reviewSignals: jsonb("review_signals").$type<Record<string, unknown>>(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    rawPrunedAt: timestamp("raw_pruned_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audits_company_idx").on(t.companyId, t.finishedAt)],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    severity: text("severity", { enum: ["high", "medium", "low"] }).notNull(),
    offer: text("offer", { enum: ["website", "ecommerce", "automation"] }).notNull(),
    /** Portuguese, human-readable, with the number it is based on. */
    text: text("text").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("findings_audit_idx").on(t.auditId), index("findings_company_idx").on(t.companyId)],
);
