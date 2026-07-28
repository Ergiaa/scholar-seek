import { db } from "@scholar-seek/db";
import { crawlHistory } from "@scholar-seek/db/schema/crawl-history";
import { desc, eq } from "drizzle-orm";
import type { CrawlOptionsBodyType, CrawlStatusResponseType } from "./model";
import { getCrawlQueue } from "./queue";

export async function startCrawl(
	body: CrawlOptionsBodyType
): Promise<{ jobId: string; historyId: string }> {
	const source = body.source ?? "arxiv";

	if (source === "semantic_scholar" && !body.query?.trim()) {
		throw new Error('The semantic_scholar source requires a "query"');
	}

	const options = {
		query: body.query,
		since: body.since,
		until: body.until,
		categories: body.categories,
		maxRecords: body.maxRecords,
	};

	// Create history record up-front so the client can track progress immediately
	const [historyRow] = await db
		.insert(crawlHistory)
		.values({
			job_id: crypto.randomUUID(),
			source,
			status: "running",
			options,
		})
		.returning({ id: crawlHistory.id, job_id: crawlHistory.job_id });

	if (!historyRow) {
		throw new Error("Failed to create crawl history record");
	}

	const job = await getCrawlQueue().add(
		"crawl",
		{ source, options, historyId: historyRow.id },
		{ jobId: historyRow.job_id }
	);

	return { jobId: job.id ?? historyRow.job_id, historyId: historyRow.id };
}

export async function getCrawlStatus(
	jobId: string
): Promise<CrawlStatusResponseType | null> {
	// Look up by job_id in the DB (source of truth for completed/failed jobs)
	const rows = await db
		.select()
		.from(crawlHistory)
		.where(eq(crawlHistory.job_id, jobId))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	return {
		jobId,
		historyId: row.id,
		source: row.source,
		status: row.status,
		papersFound: row.papers_found,
		papersInserted: row.papers_inserted,
		papersSkipped: row.papers_skipped,
		errors: row.errors ?? [],
		startedAt: row.started_at.toISOString(),
		completedAt: row.completed_at?.toISOString() ?? null,
		durationMs: row.duration_ms,
	};
}

export async function getCrawlHistory(
	limit = 20
): Promise<CrawlStatusResponseType[]> {
	const rows = await db
		.select()
		.from(crawlHistory)
		.orderBy(desc(crawlHistory.started_at))
		.limit(Math.min(limit, 100));

	return rows.map((row) => ({
		jobId: row.job_id,
		historyId: row.id,
		source: row.source,
		status: row.status,
		papersFound: row.papers_found,
		papersInserted: row.papers_inserted,
		papersSkipped: row.papers_skipped,
		errors: row.errors ?? [],
		startedAt: row.started_at.toISOString(),
		completedAt: row.completed_at?.toISOString() ?? null,
		durationMs: row.duration_ms,
	}));
}
