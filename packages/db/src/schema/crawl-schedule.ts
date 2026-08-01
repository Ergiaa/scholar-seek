import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const crawlSchedule = pgTable(
	"crawl_schedule",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		name: varchar("name", { length: 255 }).notNull(),
		source: varchar("source", { length: 100 }).notNull(),
		cron_pattern: varchar("cron_pattern", { length: 100 }).notNull(),
		enabled: boolean("enabled").default(true).notNull(),
		created_by: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		created_at: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		// Soft delete only — schedules are never hard-deleted so crawl_history
		// and crawl_schedule_run rows keep valid references.
		deleted_at: timestamp("deleted_at", { withTimezone: true }),
	},
	(table) => [
		index("crawl_schedule_source_idx").on(table.source),
		index("crawl_schedule_enabled_idx").on(table.enabled),
	]
);

export const crawlScheduleTarget = pgTable(
	"crawl_schedule_target",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		schedule_id: uuid("schedule_id")
			.notNull()
			.references(() => crawlSchedule.id, { onDelete: "cascade" }),
		label: varchar("label", { length: 255 }).notNull(),
		query: varchar("query", { length: 300 }),
		categories: jsonb("categories").$type<string[]>(),
		max_records: integer("max_records").notNull(),
	},
	(table) => [
		index("crawl_schedule_target_schedule_id_idx").on(table.schedule_id),
	]
);

export const crawlScheduleRunStatus = [
	"running",
	"completed",
	"failed",
	"cancelled",
] as const;
export type CrawlScheduleRunStatus = (typeof crawlScheduleRunStatus)[number];

export const crawlScheduleRun = pgTable(
	"crawl_schedule_run",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		schedule_id: uuid("schedule_id")
			.notNull()
			.references(() => crawlSchedule.id, { onDelete: "cascade" }),
		// null means a cron tick triggered it rather than a manual "run now"
		triggered_by: text("triggered_by").references(() => user.id, {
			onDelete: "set null",
		}),
		status: varchar("status", { length: 50 })
			.$type<CrawlScheduleRunStatus>()
			.notNull()
			.default("running"),
		started_at: timestamp("started_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		completed_at: timestamp("completed_at", { withTimezone: true }),
		cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
		target_count: integer("target_count").notNull(),
		completed_count: integer("completed_count").default(0).notNull(),
		total_requests_estimate: integer("total_requests_estimate").notNull(),
	},
	(table) => [
		index("crawl_schedule_run_schedule_id_idx").on(table.schedule_id),
		index("crawl_schedule_run_status_idx").on(table.status),
	]
);

export type CrawlSchedule = typeof crawlSchedule.$inferSelect;
export type NewCrawlSchedule = typeof crawlSchedule.$inferInsert;
export type CrawlScheduleTarget = typeof crawlScheduleTarget.$inferSelect;
export type NewCrawlScheduleTarget = typeof crawlScheduleTarget.$inferInsert;
export type CrawlScheduleRun = typeof crawlScheduleRun.$inferSelect;
export type NewCrawlScheduleRun = typeof crawlScheduleRun.$inferInsert;
