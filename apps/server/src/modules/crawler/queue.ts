import { db } from "@scholar-seek/db";
import { crawlHistory } from "@scholar-seek/db/schema/crawl-history";
import {
	crawlSchedule,
	crawlScheduleRun,
	crawlScheduleTarget,
} from "@scholar-seek/db/schema/crawl-schedule";
import { papers } from "@scholar-seek/db/schema/papers";
import { env } from "@scholar-seek/env/server";
import { Queue, Worker } from "bullmq";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { cacheDel } from "../../lib/cache";
import { getRedis } from "../../lib/redis";
import { arxivAdapter } from "./sources/arxiv";
import { doajAdapter } from "./sources/doaj";
import { semanticScholarAdapter } from "./sources/semantic-scholar";
import type { CrawlOptions, SourceAdapter } from "./sources/types";
import {
	ARXIV_GROUP_TO_CANONICAL,
	DOAJ_LCC_TO_CANONICAL,
} from "./source-taxonomies";

/**
 * Maps a yielded batch's category to the search-facing canonical vocabulary
 * (tech spec §3.2). Returns null when there's nothing to contribute this
 * round (e.g. a target with no category filter) so the onConflict COALESCE
 * below leaves an existing value alone rather than clobbering it with
 * emptiness — except DOAJ, which always has a definite answer: either the
 * mapped field or the deliberate "Uncategorized" fallback (tech spec §9).
 */
function resolveCanonicalCategories(
	source: string,
	category: string | undefined
): string[] | null {
	if (source === "semantic_scholar") {
		return category ? [category] : null;
	}
	if (source === "arxiv") {
		const field = category ? ARXIV_GROUP_TO_CANONICAL[category] : undefined;
		return field ? [field] : null;
	}
	if (source === "doaj") {
		const field = category ? DOAJ_LCC_TO_CANONICAL[category] : undefined;
		return [field ?? "Uncategorized"];
	}
	return null;
}

async function triggerMlBackfill(): Promise<void> {
	const url = `${env.ML_SERVICE_URL}/internal/backfill`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (env.ML_RELOAD_TOKEN) {
		headers["X-Reload-Token"] = env.ML_RELOAD_TOKEN;
	}
	const res = await fetch(url, { method: "POST", headers });
	if (!res.ok) {
		throw new Error(`ML backfill returned ${res.status}`);
	}
	console.log("[crawler] ML backfill triggered");
}

export type CrawlJobData =
	| {
			kind: "crawl";
			historyId: string;
			source: string;
			options: CrawlOptions;
			runId?: string;
	  }
	| {
			kind: "trigger";
			scheduleId: string;
			triggeredBy: string | null;
	  };

const QUEUE_NAME = "crawl-jobs";
// Page size is fixed at 100 records/request across every adapter, and each
// request is throttled to ~1.1s — so total requests is the one number that
// actually predicts how long (and how heavy) a plan is.
const RECORDS_PER_REQUEST = 100;

const adapters: Record<string, SourceAdapter> = {
	arxiv: arxivAdapter,
	semantic_scholar: semanticScholarAdapter,
	doaj: doajAdapter,
};

let queue: Queue<CrawlJobData> | null = null;

export function getCrawlQueue(): Queue<CrawlJobData> {
	if (!queue) {
		queue = new Queue<CrawlJobData>(QUEUE_NAME, {
			connection: getRedis(),
			defaultJobOptions: {
				attempts: 2,
				backoff: { type: "exponential", delay: 5000 },
				removeOnComplete: 200,
				removeOnFail: 100,
			},
		});
	}
	return queue;
}

export function estimateTotalRequests(
	targets: { max_records: number }[]
): number {
	return targets.reduce(
		(sum, t) => sum + Math.ceil(t.max_records / RECORDS_PER_REQUEST),
		0
	);
}

// Shared by estimateRun's response and the stats endpoint's "running past
// estimate" check — one formula, not reimplemented per caller.
export function estimatedRunSeconds(totalRequestsEstimate: number): number {
	return Math.round(totalRequestsEstimate * 1.1);
}

async function processJob(
	historyId: string,
	source: string,
	options: CrawlOptions
): Promise<{ papersInserted: number }> {
	const adapter = adapters[source];
	if (!adapter) {
		throw new Error(`Unknown source: ${source}`);
	}

	let papersFound = 0;
	let papersInserted = 0;
	let papersSkipped = 0;
	const errors: string[] = [];

	try {
		for await (const { category, papers: rawBatch } of adapter.crawl(
			options
		)) {
			// Applied once per batch, not per-paper — every paper in a batch was
			// produced by the same sub-harvest and shares its one unambiguous
			// category (tech spec §3.2, enabled by §3.3's yield-shape change).
			const canonicalCategories = resolveCanonicalCategories(source, category);
			const batch = rawBatch.map((p) => ({
				...p,
				canonical_categories: canonicalCategories,
			}));
			papersFound += batch.length;

			try {
				const result = await db
					.insert(papers)
					.values(batch)
					.onConflictDoUpdate({
						target: [papers.source, papers.source_id],
						set: {
							title: sql`excluded.title`,
							authors: sql`excluded.authors`,
							// COALESCE so a source that lacks a field (e.g. Semantic
							// Scholar records without abstracts) can't null out data
							// another source already provided for the same paper.
							abstract: sql`COALESCE(excluded.abstract, ${papers.abstract})`,
							keywords: sql`COALESCE(excluded.keywords, ${papers.keywords})`,
							canonical_categories: sql`COALESCE(excluded.canonical_categories, ${papers.canonical_categories})`,
							published_at: sql`COALESCE(excluded.published_at, ${papers.published_at})`,
							journal: sql`COALESCE(excluded.journal, ${papers.journal})`,
							doi: sql`COALESCE(excluded.doi, ${papers.doi})`,
							// Citation counts only grow — GREATEST prevents sources that
							// don't know them (arXiv OAI reports 0) from wiping enriched
							// values written by Semantic Scholar.
							citation_count: sql`GREATEST(${papers.citation_count}, excluded.citation_count)`,
						},
					})
					.returning({ id: papers.id });

				papersInserted += result.length;
				papersSkipped += batch.length - result.length;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				errors.push(`Batch insert failed: ${msg}`);
				papersSkipped += batch.length;
			}

			// Update progress in DB periodically
			await db
				.update(crawlHistory)
				.set({
					papers_found: papersFound,
					papers_inserted: papersInserted,
					papers_skipped: papersSkipped,
				})
				.where(eq(crawlHistory.id, historyId));
		}

		const completedAt = new Date();
		const startedRow = await db
			.select({ started_at: crawlHistory.started_at })
			.from(crawlHistory)
			.where(eq(crawlHistory.id, historyId));

		const startedAt = startedRow[0]?.started_at ?? completedAt;
		const durationMs = completedAt.getTime() - startedAt.getTime();

		await db
			.update(crawlHistory)
			.set({
				status:
					errors.length > 0 && papersInserted === 0 ? "failed" : "completed",
				completed_at: completedAt,
				papers_found: papersFound,
				papers_inserted: papersInserted,
				papers_skipped: papersSkipped,
				errors: errors.length > 0 ? errors : null,
				duration_ms: durationMs,
			})
			.where(eq(crawlHistory.id, historyId));

		// Invalidate paper search/journals caches now that new data exists
		await cacheDel("papers:*");
		await cacheDel("journals:*");
		await cacheDel("admin:stats");

		return { papersInserted };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);

		await db
			.update(crawlHistory)
			.set({
				status: "failed",
				completed_at: new Date(),
				papers_found: papersFound,
				papers_inserted: papersInserted,
				papers_skipped: papersSkipped,
				errors: [...errors, msg],
			})
			.where(eq(crawlHistory.id, historyId));

		throw err;
	}
}

async function getLastSuccessfulCrawlDateForTarget(
	targetId: string
): Promise<string | undefined> {
	const rows = await db
		.select({ completed_at: crawlHistory.completed_at })
		.from(crawlHistory)
		.where(
			and(
				eq(crawlHistory.target_id, targetId),
				eq(crawlHistory.status, "completed")
			)
		)
		.orderBy(desc(crawlHistory.started_at))
		.limit(1);

	const date = rows[0]?.completed_at;
	return date ? date.toISOString().slice(0, 10) : undefined;
}

/**
 * Fans a schedule out into one crawl job per target. Called both by the
 * worker's "trigger" job handler (cron tick, triggeredBy = null) and
 * directly by the run-now API path (manual, triggeredBy = the acting
 * user's id) — this is the only place fan-out logic lives.
 *
 * A disabled schedule blocks the cron path (it exists to pause exactly
 * that) but not a manual run — disabling pauses automatic firing, it
 * isn't a lock on the schedule's configuration.
 */
export async function runSchedule(
	scheduleId: string,
	triggeredBy: string | null
): Promise<{ runId: string } | null> {
	const [schedule] = await db
		.select()
		.from(crawlSchedule)
		.where(
			and(eq(crawlSchedule.id, scheduleId), isNull(crawlSchedule.deleted_at))
		);
	if (!schedule || (triggeredBy === null && !schedule.enabled)) {
		console.warn(
			`[crawler] skipping trigger for schedule ${scheduleId} — missing, deleted, or disabled`
		);
		return null;
	}

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
		console.warn(
			`[crawler] skipping trigger for schedule ${scheduleId} — a run is already in progress`
		);
		return null;
	}

	const targets = await db
		.select()
		.from(crawlScheduleTarget)
		.where(eq(crawlScheduleTarget.schedule_id, scheduleId));
	if (targets.length === 0) {
		console.warn(
			`[crawler] skipping trigger for schedule ${scheduleId} — no targets configured`
		);
		return null;
	}

	const totalRequestsEstimate = estimateTotalRequests(targets);

	const [run] = await db
		.insert(crawlScheduleRun)
		.values({
			schedule_id: scheduleId,
			triggered_by: triggeredBy,
			target_count: targets.length,
			total_requests_estimate: totalRequestsEstimate,
		})
		.returning();

	if (!run) {
		throw new Error("Failed to create crawl_schedule_run record");
	}

	const q = getCrawlQueue();
	for (const target of targets) {
		// An explicit since/until on the target always wins — it means the
		// admin wants a specific period, not the incremental "since last
		// successful crawl" window every other target gets by default.
		const since =
			target.since ?? (await getLastSuccessfulCrawlDateForTarget(target.id));
		const options: CrawlOptions = {
			query: target.query ?? undefined,
			categories: target.categories ?? undefined,
			maxRecords: target.max_records,
			since,
			until: target.until ?? undefined,
			language: target.language ?? undefined,
		};

		const [historyRow] = await db
			.insert(crawlHistory)
			.values({
				job_id: crypto.randomUUID(),
				source: target.source,
				status: "running",
				options,
				schedule_id: scheduleId,
				run_id: run.id,
				target_id: target.id,
			})
			.returning({ id: crawlHistory.id, job_id: crawlHistory.job_id });

		if (!historyRow) {
			continue;
		}

		await q.add(
			"crawl",
			{
				kind: "crawl",
				historyId: historyRow.id,
				source: target.source,
				options,
				runId: run.id,
			},
			{ jobId: historyRow.job_id }
		);
	}

	console.log(
		`[crawler] schedule "${schedule.name}" fanned out into ${targets.length} job(s), run=${run.id}, ~${totalRequestsEstimate} requests`
	);

	return { runId: run.id };
}

/**
 * Called after every crawl job that belongs to a schedule run. Once every
 * target has reported in, marks the run complete and fires the ML backfill
 * exactly once — the endpoint has no payload, so calling it per-job would
 * just be N redundant full-catalogue scans.
 */
async function recordRunProgress(runId: string): Promise<void> {
	const [updated] = await db
		.update(crawlScheduleRun)
		.set({ completed_count: sql`${crawlScheduleRun.completed_count} + 1` })
		.where(eq(crawlScheduleRun.id, runId))
		.returning({
			completed_count: crawlScheduleRun.completed_count,
			target_count: crawlScheduleRun.target_count,
			status: crawlScheduleRun.status,
		});

	if (!updated || updated.status !== "running") {
		return;
	}
	if (updated.completed_count < updated.target_count) {
		return;
	}

	await db
		.update(crawlScheduleRun)
		.set({ status: "completed", completed_at: new Date() })
		.where(eq(crawlScheduleRun.id, runId));

	const [totals] = await db
		.select({
			total: sql<number>`COALESCE(SUM(${crawlHistory.papers_inserted}), 0)`,
		})
		.from(crawlHistory)
		.where(eq(crawlHistory.run_id, runId));

	if (Number(totals?.total ?? 0) > 0) {
		triggerMlBackfill().catch((err: unknown) => {
			console.warn(
				"[crawler] ML backfill trigger failed:",
				err instanceof Error ? err.message : String(err)
			);
		});
	}
}

/**
 * Removes not-yet-started jobs for a run from the queue (used by "cancel
 * run"). Any job already executing finishes naturally.
 */
export async function removeQueuedRunJobs(runId: string): Promise<string[]> {
	const q = getCrawlQueue();
	const pending = await q.getJobs(["waiting", "delayed"]);
	const removedHistoryIds: string[] = [];
	for (const job of pending) {
		if (job.data.kind === "crawl" && job.data.runId === runId) {
			await job.remove();
			removedHistoryIds.push(job.data.historyId);
		}
	}
	return removedHistoryIds;
}

/**
 * Explicitly removes a schedule's repeatable trigger job. Used on delete —
 * a soft-deleted schedule drops out of reconcileSchedules()'s view entirely,
 * so its BullMQ registration would otherwise sit there as an unrecognized
 * "orphan" that reconciliation deliberately never touches. Deletion has to
 * be the one place that removes it, on purpose, explicitly.
 */
export async function removeScheduleTrigger(scheduleId: string): Promise<void> {
	const q = getCrawlQueue();
	const jobs = await q.getRepeatableJobs();
	const match = jobs.find((j) => j.id === scheduleId);
	if (match) {
		await q.removeRepeatableByKey(match.key);
	}
}

/**
 * On startup, any crawl_history row still in "running" status means the server
 * was killed mid-crawl. Mark them failed so they don't appear stuck forever.
 */
export async function cleanupStuckJobs(): Promise<void> {
	const stuck = await db
		.update(crawlHistory)
		.set({
			status: "failed",
			completed_at: new Date(),
			errors: ["Server stopped unexpectedly — crawl was interrupted"],
		})
		.where(eq(crawlHistory.status, "running"))
		.returning({ id: crawlHistory.id, source: crawlHistory.source });

	if (stuck.length > 0) {
		console.warn(
			`[crawler] marked ${stuck.length} interrupted job(s) as failed:`,
			stuck.map((r) => r.id).join(", ")
		);
	}

	// Any schedule_run left "running" is in the same boat — nothing left to
	// finish it, so it would otherwise block that schedule forever.
	const stuckRuns = await db
		.update(crawlScheduleRun)
		.set({ status: "failed", completed_at: new Date() })
		.where(eq(crawlScheduleRun.status, "running"))
		.returning({ id: crawlScheduleRun.id });

	if (stuckRuns.length > 0) {
		console.warn(
			`[crawler] marked ${stuckRuns.length} interrupted schedule run(s) as failed`
		);
	}
}

let worker: Worker<CrawlJobData> | null = null;

export async function stopCrawlWorker(): Promise<void> {
	if (!worker) {
		return;
	}
	console.log(
		"[crawler] shutting down worker — waiting for current batch to finish..."
	);
	await worker.close();
	worker = null;
	console.log("[crawler] worker stopped");
}

export function startCrawlWorker(): void {
	if (worker) {
		return;
	}

	worker = new Worker<CrawlJobData>(
		QUEUE_NAME,
		async (job) => {
			if (job.data.kind === "trigger") {
				const { scheduleId, triggeredBy } = job.data;
				console.log(`[crawler] trigger fired for schedule ${scheduleId}`);
				await runSchedule(scheduleId, triggeredBy);
				return;
			}

			const { source, options, historyId, runId } = job.data;
			console.log(`[crawler] starting job ${job.id} — source=${source}`);

			try {
				await processJob(historyId, source, options);
				if (runId) {
					await recordRunProgress(runId);
				}
			} catch (err) {
				// A failed attempt only counts toward the run once BullMQ won't
				// retry it again — otherwise a job that fails once and retries
				// increments completed_count twice for the same target.
				const maxAttempts = job.opts.attempts ?? 1;
				const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
				if (runId && isFinalAttempt) {
					await recordRunProgress(runId);
				}
				throw err;
			}
			console.log(`[crawler] completed job ${job.id}`);
		},
		{
			connection: getRedis(),
			concurrency: 1,
		}
	);

	worker.on("failed", (job, err) => {
		console.error(`[crawler] job ${job?.id} failed:`, err.message);
	});

	reconcileSchedules().catch((err) => {
		console.error("[crawler] failed to reconcile schedules:", err);
	});
}

/**
 * Registers a repeatable "trigger" job for every enabled, non-deleted
 * schedule and removes the BullMQ registration for any schedule that's
 * been explicitly disabled. Register-only otherwise: a repeatable job
 * with no matching schedule row at all is logged as an orphan, never
 * auto-removed — see the design discussion on undeletable state.
 */
export async function reconcileSchedules(): Promise<void> {
	const q = getCrawlQueue();
	const schedules = await db
		.select()
		.from(crawlSchedule)
		.where(isNull(crawlSchedule.deleted_at));
	const repeatableJobs = await q.getRepeatableJobs();
	const repeatableById = new Map(
		repeatableJobs.filter((j) => j.id).map((j) => [j.id as string, j])
	);
	const knownScheduleIds = new Set(schedules.map((s) => s.id));

	for (const schedule of schedules) {
		const existing = repeatableById.get(schedule.id);

		if (!schedule.enabled) {
			if (existing) {
				await q.removeRepeatableByKey(existing.key);
				console.log(
					`[crawler] removed repeatable trigger for disabled schedule "${schedule.name}"`
				);
			}
			continue;
		}

		if (existing && existing.pattern === schedule.cron_pattern) {
			continue;
		}

		if (existing) {
			await q.removeRepeatableByKey(existing.key);
		}

		await q.add(
			"trigger",
			{ kind: "trigger", scheduleId: schedule.id, triggeredBy: null },
			{ repeat: { pattern: schedule.cron_pattern }, jobId: schedule.id }
		);
		console.log(
			`[crawler] registered trigger for schedule "${schedule.name}" @ ${schedule.cron_pattern}`
		);
	}

	for (const job of repeatableJobs) {
		if (job.id && !knownScheduleIds.has(job.id)) {
			console.warn(
				`[crawler] orphaned repeatable job (no matching schedule): name=${job.name} id=${job.id} pattern=${job.pattern}`
			);
		}
	}
}
