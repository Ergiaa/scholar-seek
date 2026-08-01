import { db } from "@scholar-seek/db";
import {
	crawlSchedule,
	crawlScheduleRun,
} from "@scholar-seek/db/schema/crawl-schedule";
import { papers } from "@scholar-seek/db/schema/papers";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { cacheGet, cacheSet } from "../../lib/cache";
import type { StatsResponseType } from "./model";
import { estimatedRunSeconds } from "./queue";
import { getCrawlHistory } from "./service";

type AttentionItem = StatsResponseType["attention"][number];

const STATS_CACHE_KEY = "admin:stats";
const STATS_CACHE_TTL_SECONDS = 45;
const RECENT_ACTIVITY_LIMIT = 10;

async function computeStats(): Promise<StatsResponseType> {
	const [
		[paperStats],
		bySourceRows,
		[activeSchedulesRow],
		[runningNowRow],
		recentActivity,
		latestRunPerSchedule,
	] = await Promise.all([
		db
			.select({
				total: sql<number>`COUNT(*)`,
				added24h: sql<number>`COUNT(*) FILTER (WHERE ${papers.created_at} >= now() - interval '24 hours')`,
				added7d: sql<number>`COUNT(*) FILTER (WHERE ${papers.created_at} >= now() - interval '7 days')`,
				embeddingCoveragePercent: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${papers.embedding_stored}) * 100.0 / NULLIF(COUNT(*), 0), 0)`,
			})
			.from(papers),
		db
			.select({ source: papers.source, count: count() })
			.from(papers)
			.groupBy(papers.source),
		db
			.select({ count: count() })
			.from(crawlSchedule)
			.where(
				and(eq(crawlSchedule.enabled, true), isNull(crawlSchedule.deleted_at))
			),
		db
			.select({ count: count() })
			.from(crawlScheduleRun)
			.where(eq(crawlScheduleRun.status, "running")),
		getCrawlHistory({ pageSize: RECENT_ACTIVITY_LIMIT, page: 1 }).then(
			(r) => r.history
		),
		// One query for every schedule's most recent run — avoids an N+1 loop
		// per schedule (tech spec §7).
		db
			.selectDistinctOn([crawlScheduleRun.schedule_id], {
				scheduleId: crawlScheduleRun.schedule_id,
				scheduleName: crawlSchedule.name,
				status: crawlScheduleRun.status,
				startedAt: crawlScheduleRun.started_at,
				totalRequestsEstimate: crawlScheduleRun.total_requests_estimate,
			})
			.from(crawlScheduleRun)
			.innerJoin(
				crawlSchedule,
				eq(crawlScheduleRun.schedule_id, crawlSchedule.id)
			)
			.orderBy(asc(crawlScheduleRun.schedule_id), desc(crawlScheduleRun.started_at)),
	]);

	const now = Date.now();
	const attention: AttentionItem[] = [];
	for (const run of latestRunPerSchedule) {
		let reason: AttentionItem["reason"] | null = null;
		if (run.status === "failed") {
			reason = "failed";
		} else if (run.status === "running") {
			const deadline =
				run.startedAt.getTime() +
				estimatedRunSeconds(run.totalRequestsEstimate) * 1000;
			if (now > deadline) {
				reason = "running_past_estimate";
			}
		}
		if (reason) {
			attention.push({
				scheduleId: run.scheduleId,
				scheduleName: run.scheduleName,
				status: run.status,
				startedAt: run.startedAt.toISOString(),
				reason,
			});
		}
	}

	return {
		totalPapers: Number(paperStats?.total ?? 0),
		papersAdded24h: Number(paperStats?.added24h ?? 0),
		papersAdded7d: Number(paperStats?.added7d ?? 0),
		embeddingCoveragePercent: Number(paperStats?.embeddingCoveragePercent ?? 0),
		bySource: bySourceRows.map((r) => ({ source: r.source, count: r.count })),
		activeSchedules: activeSchedulesRow?.count ?? 0,
		runningNow: runningNowRow?.count ?? 0,
		recentActivity,
		attention,
	};
}

export async function getStats(): Promise<StatsResponseType> {
	const cached = await cacheGet<StatsResponseType>(STATS_CACHE_KEY);
	if (cached) {
		return cached;
	}

	const stats = await computeStats();
	await cacheSet(STATS_CACHE_KEY, stats, STATS_CACHE_TTL_SECONDS);
	return stats;
}
