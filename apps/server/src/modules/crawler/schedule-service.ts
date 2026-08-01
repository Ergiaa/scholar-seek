import { db } from "@scholar-seek/db";
import { user } from "@scholar-seek/db/schema/auth";
import { crawlHistory } from "@scholar-seek/db/schema/crawl-history";
import {
	crawlSchedule,
	crawlScheduleRun,
	crawlScheduleTarget,
} from "@scholar-seek/db/schema/crawl-schedule";
import { env } from "@scholar-seek/env/server";
import { CronExpressionParser } from "cron-parser";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { status } from "elysia";
import { ROOT_ADMIN_ROLE } from "../../lib/auth";
import type {
	CreateScheduleBodyType,
	RunEstimateResponseType,
	RunResponseType,
	ScheduleResponseType,
	UpdateScheduleBodyType,
} from "./model";
import {
	estimatedRunSeconds,
	estimateTotalRequests,
	removeQueuedRunJobs,
	removeScheduleTrigger,
	reconcileSchedules,
	runSchedule,
} from "./queue";

interface DefaultTargetConfig {
	label: string;
	source: string;
	query?: string;
	categories?: string[];
	maxRecords: number;
}

interface DefaultScheduleConfig {
	name: string;
	cronPattern: string;
	targets: DefaultTargetConfig[];
}

// Semantic Scholar's bulk search has no "everything since X" mode — unlike
// arXiv/DOAJ, a query is mandatory (see validateTargetsForSource). A
// handful of broad field-of-study queries gives real daily coverage
// without needing the dynamic single-field-per-day rotation the old
// hardcoded scheduler used.
const SEMANTIC_SCHOLAR_DEFAULT_FIELDS = [
	"Computer Science",
	"Medicine",
	"Biology",
	"Physics",
	"Engineering",
];

// Mirrors the previous hardcoded RECURRING_CRAWLS array — staggered five
// minutes apart so the single-concurrency worker isn't asked to start
// multiple crawls at once. maxRecords is a generous safety cap; the daily
// incremental window (since last successful run) keeps actual volume small.
const DEFAULT_SCHEDULES: DefaultScheduleConfig[] = [
	{
		name: "Daily arXiv crawl",
		cronPattern: "25 3 * * *",
		targets: [{ label: "arxiv daily", source: "arxiv", maxRecords: 5000 }],
	},
	{
		name: "Daily DOAJ crawl",
		cronPattern: "30 3 * * *",
		targets: [{ label: "doaj daily", source: "doaj", maxRecords: 5000 }],
	},
	{
		name: "Daily Semantic Scholar crawl",
		cronPattern: "35 3 * * *",
		targets: SEMANTIC_SCHOLAR_DEFAULT_FIELDS.map((field) => ({
			label: `semantic_scholar daily — ${field}`,
			source: "semantic_scholar",
			query: field,
			categories: [field],
			maxRecords: 1000,
		})),
	},
];

// Runs once on boot, after the root admin exists. No-op once any schedule
// exists — this only ever seeds the initial set on a fresh database.
export async function ensureDefaultSchedules(): Promise<void> {
	const [existing] = await db
		.select({ id: crawlSchedule.id })
		.from(crawlSchedule)
		.limit(1);
	if (existing) {
		return;
	}

	const [rootAdmin] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, ROOT_ADMIN_ROLE));
	if (!rootAdmin) {
		return;
	}

	for (const config of DEFAULT_SCHEDULES) {
		const [schedule] = await db
			.insert(crawlSchedule)
			.values({
				name: config.name,
				cron_pattern: config.cronPattern,
				created_by: rootAdmin.id,
			})
			.returning({ id: crawlSchedule.id });

		if (!schedule) {
			continue;
		}

		await db.insert(crawlScheduleTarget).values(
			config.targets.map((t) => ({
				schedule_id: schedule.id,
				label: t.label,
				source: t.source,
				query: t.query,
				categories: t.categories,
				max_records: t.maxRecords,
			}))
		);
	}

	console.log(`[crawler] seeded ${DEFAULT_SCHEDULES.length} default schedule(s)`);
}

function validateCronPattern(pattern: string): void {
	try {
		CronExpressionParser.parse(pattern);
	} catch {
		throw status(400, { error: `Invalid cron pattern: "${pattern}"` });
	}
}

// Mirrors the same rule startCrawl() enforces for ad-hoc /crawl/start jobs —
// semantic_scholar's bulk search has no "everything since X" mode, so a
// target without a query would silently fail on every run. Each target now
// carries its own source, so this validates per-target rather than once for
// the whole schedule.
function validateTargetsForSource(
	targets: { label: string; source: string; query?: string }[]
): void {
	const missingQuery = targets.find(
		(t) => t.source === "semantic_scholar" && !t.query?.trim()
	);
	if (missingQuery) {
		throw status(400, {
			error: `Target "${missingQuery.label}" requires a query for the semantic_scholar source`,
		});
	}
}

async function getActiveScheduleOrThrow(id: string) {
	const [schedule] = await db
		.select()
		.from(crawlSchedule)
		.where(and(eq(crawlSchedule.id, id), isNull(crawlSchedule.deleted_at)));
	if (!schedule) {
		throw status(404, { error: "Schedule not found" });
	}
	return schedule;
}

async function toScheduleResponse(
	schedule: typeof crawlSchedule.$inferSelect
): Promise<ScheduleResponseType> {
	const targets = await db
		.select()
		.from(crawlScheduleTarget)
		.where(eq(crawlScheduleTarget.schedule_id, schedule.id));

	const [lastRun] = await db
		.select({
			id: crawlScheduleRun.id,
			status: crawlScheduleRun.status,
			started_at: crawlScheduleRun.started_at,
			completed_at: crawlScheduleRun.completed_at,
		})
		.from(crawlScheduleRun)
		.where(eq(crawlScheduleRun.schedule_id, schedule.id))
		.orderBy(desc(crawlScheduleRun.started_at))
		.limit(1);

	return {
		id: schedule.id,
		name: schedule.name,
		cronPattern: schedule.cron_pattern,
		enabled: schedule.enabled,
		createdBy: schedule.created_by,
		createdAt: schedule.created_at.toISOString(),
		updatedAt: schedule.updated_at.toISOString(),
		targets: targets.map((t) => ({
			id: t.id,
			label: t.label,
			source: t.source,
			query: t.query,
			categories: t.categories,
			maxRecords: t.max_records,
		})),
		lastRun: lastRun
			? {
					id: lastRun.id,
					status: lastRun.status,
					startedAt: lastRun.started_at.toISOString(),
					completedAt: lastRun.completed_at?.toISOString() ?? null,
				}
			: null,
	};
}

export async function listSchedules(): Promise<ScheduleResponseType[]> {
	const schedules = await db
		.select()
		.from(crawlSchedule)
		.where(isNull(crawlSchedule.deleted_at))
		.orderBy(desc(crawlSchedule.created_at));
	return Promise.all(schedules.map(toScheduleResponse));
}

export async function createSchedule(
	body: CreateScheduleBodyType,
	createdBy: string
): Promise<ScheduleResponseType> {
	validateCronPattern(body.cronPattern);
	validateTargetsForSource(body.targets);

	const [schedule] = await db
		.insert(crawlSchedule)
		.values({
			name: body.name,
			cron_pattern: body.cronPattern,
			created_by: createdBy,
		})
		.returning();

	if (!schedule) {
		throw new Error("Failed to create schedule");
	}

	await db.insert(crawlScheduleTarget).values(
		body.targets.map((t) => ({
			schedule_id: schedule.id,
			label: t.label,
			source: t.source,
			query: t.query,
			categories: t.categories,
			max_records: t.maxRecords,
		}))
	);

	await reconcileSchedules();
	return toScheduleResponse(schedule);
}

export async function updateSchedule(
	id: string,
	body: UpdateScheduleBodyType
): Promise<ScheduleResponseType> {
	const existing = await getActiveScheduleOrThrow(id);

	if (body.cronPattern) {
		validateCronPattern(body.cronPattern);
	}
	if (body.targets) {
		validateTargetsForSource(body.targets);
	}

	const [updated] = await db
		.update(crawlSchedule)
		.set({
			name: body.name ?? existing.name,
			cron_pattern: body.cronPattern ?? existing.cron_pattern,
			enabled: body.enabled ?? existing.enabled,
		})
		.where(eq(crawlSchedule.id, id))
		.returning();

	if (!updated) {
		throw new Error("Failed to update schedule");
	}

	if (body.targets) {
		await db
			.delete(crawlScheduleTarget)
			.where(eq(crawlScheduleTarget.schedule_id, id));
		await db.insert(crawlScheduleTarget).values(
			body.targets.map((t) => ({
				schedule_id: id,
				label: t.label,
				source: t.source,
				query: t.query,
				categories: t.categories,
				max_records: t.maxRecords,
			}))
		);
	}

	await reconcileSchedules();
	return toScheduleResponse(updated);
}

export async function deleteSchedule(id: string): Promise<void> {
	await getActiveScheduleOrThrow(id);
	await db
		.update(crawlSchedule)
		.set({ deleted_at: new Date() })
		.where(eq(crawlSchedule.id, id));
	// Explicit removal — a soft-deleted schedule drops out of
	// reconcileSchedules()'s view, so nothing else would ever clean this up.
	await removeScheduleTrigger(id);
}

export async function estimateRun(
	scheduleId: string
): Promise<RunEstimateResponseType> {
	await getActiveScheduleOrThrow(scheduleId);
	const targets = await db
		.select({
			max_records: crawlScheduleTarget.max_records,
			source: crawlScheduleTarget.source,
		})
		.from(crawlScheduleTarget)
		.where(eq(crawlScheduleTarget.schedule_id, scheduleId));

	const totalRequestsEstimate = estimateTotalRequests(targets);
	return {
		scheduleId,
		targetCount: targets.length,
		totalRequestsEstimate,
		estimatedSeconds: estimatedRunSeconds(totalRequestsEstimate),
		requiresOverride:
			totalRequestsEstimate > env.CRAWL_RUN_SOFT_THRESHOLD_REQUESTS,
		sharedPoolWarning:
			targets.some((t) => t.source === "semantic_scholar") && !env.S2_API_KEY,
	};
}

async function toRunResponse(
	run: typeof crawlScheduleRun.$inferSelect
): Promise<RunResponseType> {
	// run.status only tracks whether every target has reported in, not
	// whether they succeeded — surface actual failures separately so
	// "completed" never reads as "everything worked" when it didn't.
	const [failed] = await db
		.select({ count: count() })
		.from(crawlHistory)
		.where(
			and(eq(crawlHistory.run_id, run.id), eq(crawlHistory.status, "failed"))
		);

	return {
		id: run.id,
		scheduleId: run.schedule_id,
		status: run.status,
		targetCount: run.target_count,
		completedCount: run.completed_count,
		failedCount: failed?.count ?? 0,
		totalRequestsEstimate: run.total_requests_estimate,
		startedAt: run.started_at.toISOString(),
		completedAt: run.completed_at?.toISOString() ?? null,
		cancelledAt: run.cancelled_at?.toISOString() ?? null,
	};
}

export async function confirmRun(
	scheduleId: string,
	actor: { id: string; role?: string | null | undefined },
	override: boolean | undefined
): Promise<RunResponseType> {
	await getActiveScheduleOrThrow(scheduleId);

	const [activeRun] = await db
		.select({ id: crawlScheduleRun.id })
		.from(crawlScheduleRun)
		.where(
			and(
				eq(crawlScheduleRun.schedule_id, scheduleId),
				eq(crawlScheduleRun.status, "running")
			)
		);
	if (activeRun) {
		throw status(409, { error: "A run is already in progress for this schedule" });
	}

	const estimate = await estimateRun(scheduleId);
	if (estimate.targetCount === 0) {
		throw status(400, { error: "Schedule has no targets configured" });
	}
	if (
		estimate.requiresOverride &&
		actor.role !== ROOT_ADMIN_ROLE &&
		!override
	) {
		throw status(428, {
			error: "override_required",
			...estimate,
		});
	}

	const result = await runSchedule(scheduleId, actor.id);
	if (!result) {
		throw status(409, { error: "Failed to start run — try again" });
	}

	const [run] = await db
		.select()
		.from(crawlScheduleRun)
		.where(eq(crawlScheduleRun.id, result.runId));
	if (!run) {
		throw new Error("Run vanished immediately after creation");
	}
	return toRunResponse(run);
}

export async function getRun(runId: string): Promise<RunResponseType> {
	const [run] = await db
		.select()
		.from(crawlScheduleRun)
		.where(eq(crawlScheduleRun.id, runId));
	if (!run) {
		throw status(404, { error: "Run not found" });
	}
	return toRunResponse(run);
}

export async function cancelRun(runId: string): Promise<RunResponseType> {
	const [run] = await db
		.select()
		.from(crawlScheduleRun)
		.where(eq(crawlScheduleRun.id, runId));
	if (!run) {
		throw status(404, { error: "Run not found" });
	}
	if (run.status !== "running") {
		throw status(409, { error: `Run is already ${run.status}` });
	}

	const removedHistoryIds = await removeQueuedRunJobs(runId);
	// Only the specific rows for jobs actually removed from the queue —
	// never a blanket "running" filter for the run, which would also catch
	// (and incorrectly stomp on) a job the worker is actively processing
	// right now, whose crawl_history row is legitimately still "running".
	if (removedHistoryIds.length > 0) {
		await db
			.update(crawlHistory)
			.set({
				status: "failed",
				completed_at: new Date(),
				errors: ["Cancelled by admin"],
			})
			.where(inArray(crawlHistory.id, removedHistoryIds));
	}

	const [cancelled] = await db
		.update(crawlScheduleRun)
		.set({ status: "cancelled", cancelled_at: new Date() })
		.where(eq(crawlScheduleRun.id, runId))
		.returning();

	if (!cancelled) {
		throw new Error("Failed to cancel run");
	}
	return toRunResponse(cancelled);
}
