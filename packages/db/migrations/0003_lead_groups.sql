ALTER TYPE "public"."dedupe_status" ADD VALUE 'grouped';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_group_id_companies_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_group_idx" ON "companies" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_group_not_self" CHECK ("companies"."group_id" <> "companies"."id");