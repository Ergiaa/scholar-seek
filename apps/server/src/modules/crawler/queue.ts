import { db } from "@scholar-seek/db";
import { crawlHistory } from "@scholar-seek/db/schema/crawl-history";
import { papers } from "@scholar-seek/db/schema/papers";
import { env } from "@scholar-seek/env/server";
import { Queue, Worker } from "bullmq";
import { desc, eq, sql } from "drizzle-orm";
import { cacheDel } from "../../lib/cache";
import { getRedis } from "../../lib/redis";
import { arxivAdapter } from "./sources/arxiv";
import type { CrawlOptions, SourceAdapter } from "./sources/types";

export interface CrawlJobData {
	/** UUID of the crawl_history row. Created by the service before enqueuing. */
	historyId: string;
	options: CrawlOptions;
	source: string;
}

const QUEUE_NAME = "crawl-jobs";

const adapters: Record<string, SourceAdapter> = {
	arxiv: arxivAdapter,
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

async function processJob(
	historyId: string,
	source: string,
	options: CrawlOptions
): Promise<void> {
	const adapter = adapters[source];
	if (!adapter) {
		throw new Error(`Unknown source: ${source}`);
	}

	let papersFound = 0;
	let papersInserted = 0;
	let papersSkipped = 0;
	const errors: string[] = [];

	try {
		for await (const batch of adapter.crawl(options)) {
			papersFound += batch.length;

			try {
				const result = await db
					.insert(papers)
					.values(batch)
					.onConflictDoUpdate({
						target: [papers.source, papers.source_id],
						set: {
							title: sql`excluded.title`,
							abstract: sql`excluded.abstract`,
							authors: sql`excluded.authors`,
							keywords: sql`excluded.keywords`,
							published_at: sql`excluded.published_at`,
							journal: sql`excluded.journal`,
							doi: sql`excluded.doi`,
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

async function getLastSuccessfulCrawlDate(
	source: string
): Promise<string | undefined> {
	const rows = await db
		.select({ completed_at: crawlHistory.completed_at })
		.from(crawlHistory)
		.where(eq(crawlHistory.source, source))
		.orderBy(desc(crawlHistory.started_at))
		.limit(1);

	const date = rows[0]?.completed_at;
	if (!date) {
		return undefined;
	}
	return date.toISOString().slice(0, 10);
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
			let { source, options, historyId } = job.data;
			console.log(`[crawler] starting job ${job.id} — source=${source}`);

			// Auto-scheduled jobs don't have a pre-created history record
			if (historyId === "__auto__") {
				const resolved = await createAutoHistoryRecord(source, options);
				historyId = resolved.historyId;
				options = resolved.options;
			}

			await processJob(historyId, source, options);
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

	// Register a daily production crawl via a repeatable job
	if (env.NODE_ENV === "production") {
		scheduleDailyCrawl().catch((err) => {
			console.error("[crawler] failed to register daily job:", err);
		});
	}
}

async function scheduleDailyCrawl(): Promise<void> {
	// The daily job itself creates a history record at run time via a sentinel wrapper.
	// We use a special job name and handle it in the worker.
	const q = getCrawlQueue();

	// Remove any stale daily job first, then re-add with current settings.
	await q.removeRepeatable("daily-arxiv", { pattern: "0 2 * * *" });
	await q.add(
		"daily-arxiv-trigger",
		// historyId is empty; the service.enqueueAutoJob creates it at run time
		{ source: "arxiv", options: {}, historyId: "__auto__" },
		{
			repeat: { pattern: "0 2 * * *" },
			jobId: "daily-arxiv",
		}
	);
}

/**
 * Called by the auto-scheduled worker before processJob when historyId === "__auto__".
 * Creates a fresh crawl_history row using the last successful crawl date as `since`.
 */
export async function createAutoHistoryRecord(
	source: string,
	options: CrawlOptions
): Promise<{ historyId: string; options: CrawlOptions }> {
	const since = await getLastSuccessfulCrawlDate(source);
	const resolvedOptions: CrawlOptions = { ...options, since };

	const [row] = await db
		.insert(crawlHistory)
		.values({
			job_id: crypto.randomUUID(),
			source,
			status: "running",
			options: resolvedOptions,
		})
		.returning({ id: crawlHistory.id });

	if (!row) {
		throw new Error("Failed to create crawl_history record");
	}
	return { historyId: row.id, options: resolvedOptions };
}
