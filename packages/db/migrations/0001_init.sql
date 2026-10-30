CREATE TYPE "public"."actor" AS ENUM('system', 'diego');--> statement-breakpoint
CREATE TYPE "public"."dedupe_rule" AS ENUM('domain_city_mismatch', 'phone_name_mismatch', 'fuzzy_name_city');--> statement-breakpoint
CREATE TYPE "public"."dedupe_status" AS ENUM('pending', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."import_outcome" AS ENUM('created', 'merged', 'review', 'suppressed', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('manual_csv', 'manual_paste', 'manual_form', 'google_places', 'cnpj', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('discovered', 'audited', 'scored', 'draft_ready', 'contacted', 'replied', 'qualified', 'call_booked', 'proposal_sent', 'won', 'lost', 'opted_out');--> statement-breakpoint
CREATE TYPE "public"."suppression_kind" AS ENUM('email', 'phone', 'domain', 'cnpj');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"match_name" text NOT NULL,
	"city" text,
	"city_normalized" text,
	"state" text,
	"cnpj" text,
	"domain" text,
	"website_url" text,
	"phone_e164" text,
	"email" text,
	"instagram_handle" text,
	"niche" text,
	"notes" text,
	"stage" "stage" DEFAULT 'discovered' NOT NULL,
	"source" "lead_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cnpj_format" CHECK ("companies"."cnpj" ~ '^[0-9]{14}$'),
	CONSTRAINT "companies_state_format" CHECK ("companies"."state" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone_e164" text,
	"linkedin_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dedupe_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_a" uuid NOT NULL,
	"company_b" uuid NOT NULL,
	"rule" "dedupe_rule" NOT NULL,
	"similarity" real,
	"status" "dedupe_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dedupe_candidates_distinct" CHECK ("dedupe_candidates"."company_a" <> "dedupe_candidates"."company_b")
);
--> statement-breakpoint
CREATE TABLE "field_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"source" "lead_source" NOT NULL,
	"source_ref" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb,
	"outcome" "import_outcome" NOT NULL,
	"company_id" uuid,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "lead_source" NOT NULL,
	"filename" text,
	"file_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"review" integer DEFAULT 0 NOT NULL,
	"suppressed" integer DEFAULT 0 NOT NULL,
	"invalid" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_stage" "stage",
	"to_stage" "stage" NOT NULL,
	"actor" "actor" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "suppression_kind" NOT NULL,
	"value_hash" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressions_value_hash_unique" UNIQUE("value_hash")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedupe_candidates" ADD CONSTRAINT "dedupe_candidates_company_a_companies_id_fk" FOREIGN KEY ("company_a") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedupe_candidates" ADD CONSTRAINT "dedupe_candidates_company_b_companies_id_fk" FOREIGN KEY ("company_b") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_sources" ADD CONSTRAINT "field_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_domain_idx" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_cnpj_key" ON "companies" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "companies_phone_idx" ON "companies" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "companies_city_idx" ON "companies" USING btree ("city_normalized");--> statement-breakpoint
CREATE INDEX "companies_stage_idx" ON "companies" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "companies_match_name_trgm_idx" ON "companies" USING gin ("match_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dedupe_candidates_pair_key" ON "dedupe_candidates" USING btree ("company_a","company_b");--> statement-breakpoint
CREATE INDEX "dedupe_candidates_status_idx" ON "dedupe_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "field_sources_company_idx" ON "field_sources" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "import_rows_import_idx" ON "import_rows" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "import_rows_company_idx" ON "import_rows" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "imports_file_hash_idx" ON "imports" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "stage_events_company_idx" ON "stage_events" USING btree ("company_id","created_at");