import { DEDUPE_RULES, LEAD_SOURCES, STAGES, SUPPRESSION_KINDS } from "@wbz/core";
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
  },
  (t) => [index("field_sources_company_idx").on(t.companyId)],
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
