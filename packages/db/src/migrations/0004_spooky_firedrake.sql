CREATE TABLE "crawl_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"source" varchar(100) NOT NULL,
	"cron_pattern" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crawl_schedule_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"triggered_by" text,
	"status" varchar(50) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"target_count" integer NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"total_requests_estimate" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_schedule_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"query" varchar(300),
	"categories" jsonb,
	"max_records" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_history" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "crawl_history" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "crawl_schedule" ADD CONSTRAINT "crawl_schedule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_schedule_run" ADD CONSTRAINT "crawl_schedule_run_schedule_id_crawl_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."crawl_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_schedule_run" ADD CONSTRAINT "crawl_schedule_run_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_schedule_target" ADD CONSTRAINT "crawl_schedule_target_schedule_id_crawl_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."crawl_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_schedule_source_idx" ON "crawl_schedule" USING btree ("source");--> statement-breakpoint
CREATE INDEX "crawl_schedule_enabled_idx" ON "crawl_schedule" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "crawl_schedule_run_schedule_id_idx" ON "crawl_schedule_run" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "crawl_schedule_run_status_idx" ON "crawl_schedule_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "crawl_schedule_target_schedule_id_idx" ON "crawl_schedule_target" USING btree ("schedule_id");--> statement-breakpoint
ALTER TABLE "crawl_history" ADD CONSTRAINT "crawl_history_schedule_id_crawl_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."crawl_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_history" ADD CONSTRAINT "crawl_history_run_id_crawl_schedule_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_schedule_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_history_schedule_id_idx" ON "crawl_history" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "crawl_history_run_id_idx" ON "crawl_history" USING btree ("run_id");