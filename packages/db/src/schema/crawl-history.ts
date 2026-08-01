import {
	index,
	integer,
	jsonb,
	pgTable,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { crawlSchedule, crawlScheduleRun } from "./crawl-schedule";

export const crawlStatus = ["completed", "failed", "running"] as const;
export type CrawlStatus = (typeof crawlStatus)[number];

export const crawlHistory = pgTable(
	"crawl_history",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		job_id: varchar("job_id", { length: 255 }).notNull(),
		source: varchar("source", { length: 100 }).notNull(),
		status: varchar("status", { length: 50 }).$type<CrawlStatus>().notNull(), // 'completed', 'failed', 'running'
		started_at: timestamp("started_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		completed_at: timestamp("completed_at", { withTimezone: true }),
		papers_found: integer("papers_found").default(0).notNull(),
		papers_inserted: integer("papers_inserted").default(0).notNull(),
		papers_skipped: integer("papers_skipped").default(0).notNull(),
		errors: jsonb("errors").$type<string[]>(),
		duration_ms: integer("duration_ms"),
		options: jsonb("options"), // Store crawl options (since, until, categories, etc.)
		// Which schedule produced this run, if any — lets "since" be computed
		// per-schedule instead of per-source so schedules sharing a source
		// with different queries don't clobber each other's watermark.
		schedule_id: uuid("schedule_id").references(() => crawlSchedule.id, {
			onDelete: "set null",
		}),
		run_id: uuid("run_id").references(() => crawlScheduleRun.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("crawl_history_source_idx").on(table.source),
		index("crawl_history_started_at_idx").on(table.started_at),
		index("crawl_history_status_idx").on(table.status),
		index("crawl_history_schedule_id_idx").on(table.schedule_id),
		index("crawl_history_run_id_idx").on(table.run_id),
	]
);

export type CrawlHistory = typeof crawlHistory.$inferSelect;
export type NewCrawlHistory = typeof crawlHistory.$inferInsert;
