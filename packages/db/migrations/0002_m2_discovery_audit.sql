CREATE TYPE "public"."audit_status" AS ENUM('ok', 'no_website', 'unreachable', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'running', 'done', 'stopped_budget');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('discover_query', 'audit_lead', 'prune_expired');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('wordpress', 'woocommerce', 'wix', 'shopify', 'nuvemshop', 'vtex', 'linx', 'tray', 'loja_integrada', 'squarespace', 'custom');--> statement-breakpoint
ALTER TYPE "public"."lead_source" ADD VALUE 'website_audit';--> statement-breakpoint
CREATE TABLE "api_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"key_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "audit_status" NOT NULL,
	"url" text,
	"final_url" text,
	"error" text,
	"platform" "platform",
	"http_status" integer,
	"pagespeed" jsonb,
	"html_checks" jsonb,
	"broken_links" jsonb,
	"review_signals" jsonb,
	"raw" jsonb,
	"raw_pruned_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_companies" (
	"campaign_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"niche" text NOT NULL,
	"query_template" text NOT NULL,
	"cities" jsonb NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"places_request_cap" integer NOT NULL,
	"places_requests_used" integer DEFAULT 0 NOT NULL,
	"est_cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_cap_positive" CHECK ("campaigns"."places_request_cap" > 0),
	CONSTRAINT "campaigns_used_within_cap" CHECK ("campaigns"."places_requests_used" <= "campaigns"."places_request_cap")
);
--> statement-breakpoint
CREATE TABLE "discovery_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"city" text NOT NULL,
	"query" text NOT NULL,
	"page" integer NOT NULL,
	"page_token" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_count" integer,
	"created" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"offer" text NOT NULL,
	"text" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "job_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "maps_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "google_rating" real;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "google_review_count" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "places_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "platform" "platform";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "last_audited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "field_sources" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_companies" ADD CONSTRAINT "campaign_companies_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_companies" ADD CONSTRAINT "campaign_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_queries" ADD CONSTRAINT "discovery_queries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_queries" ADD CONSTRAINT "discovery_queries_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_cache_key" ON "api_cache" USING btree ("provider","key_hash");--> statement-breakpoint
CREATE INDEX "api_cache_expires_idx" ON "api_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audits_company_idx" ON "audits" USING btree ("company_id","finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_companies_key" ON "campaign_companies" USING btree ("campaign_id","company_id");--> statement-breakpoint
CREATE INDEX "campaign_companies_company_idx" ON "campaign_companies" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_queries_page_key" ON "discovery_queries" USING btree ("campaign_id","city","page");--> statement-breakpoint
CREATE INDEX "findings_audit_idx" ON "findings" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "findings_company_idx" ON "findings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_status_run_after_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "jobs" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_place_id_key" ON "companies" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "companies_created_idx" ON "companies" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "field_sources_expires_idx" ON "field_sources" USING btree ("expires_at");