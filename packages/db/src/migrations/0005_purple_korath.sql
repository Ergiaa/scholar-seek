DROP INDEX "crawl_schedule_source_idx";--> statement-breakpoint
ALTER TABLE "crawl_history" ADD COLUMN "target_id" uuid;--> statement-breakpoint
ALTER TABLE "crawl_schedule_target" ADD COLUMN "source" varchar(100);--> statement-breakpoint
UPDATE "crawl_schedule_target" t SET "source" = s."source" FROM "crawl_schedule" s WHERE t."schedule_id" = s."id";--> statement-breakpoint
ALTER TABLE "crawl_schedule_target" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "papers" ADD COLUMN "canonical_categories" jsonb;--> statement-breakpoint
ALTER TABLE "crawl_history" ADD CONSTRAINT "crawl_history_target_id_crawl_schedule_target_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."crawl_schedule_target"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_history_target_id_idx" ON "crawl_history" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "crawl_schedule_target_source_idx" ON "crawl_schedule_target" USING btree ("source");--> statement-breakpoint
CREATE INDEX "papers_created_at_idx" ON "papers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "papers_canonical_categories_gin_idx" ON "papers" USING gin ("canonical_categories");--> statement-breakpoint
ALTER TABLE "crawl_schedule" DROP COLUMN "source";