import { db } from "@scholar-seek/db";
import { crawlHistory, type CrawlStatus } from "@scholar-seek/db/schema/crawl-history";
import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type {
	CrawlOptionsBodyType,
	CrawlStatusResponseType,
} from "./model";
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
		{ kind: "crawl", source, options, historyId: historyRow.id },
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

	return toCrawlStatusResponse(row);
}

function toCrawlStatusResponse(
	row: typeof crawlHistory.$inferSelect
): CrawlStatusResponseType {
	return {
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
	};
}

export interface CrawlHistoryParams {
	source?: string;
	status?: CrawlStatus;
	since?: string;
	until?: string;
	page?: number;
	pageSize?: number;
}

// Mirrors papers/service.ts's buildFilterConditions pattern — conditionally
// composed and()/eq()/gte()/lte(), applied to crawl_history instead of papers.
function buildCrawlHistoryFilterConditions(
	params: CrawlHistoryParams
): (SQL | undefined)[] {
	const conditions: (SQL | undefined)[] = [];

	if (params.source) {
		conditions.push(eq(crawlHistory.source, params.source));
	}
	if (params.status) {
		conditions.push(eq(crawlHistory.status, params.status));
	}
	if (params.since) {
		conditions.push(gte(crawlHistory.started_at, new Date(params.since)));
	}
	if (params.until) {
		conditions.push(lte(crawlHistory.started_at, new Date(params.until)));
	}

	return conditions;
}

export async function getCrawlHistory(params: CrawlHistoryParams): Promise<{
	history: CrawlStatusResponseType[];
	total: number;
	page: number;
	pageSize: number;
}> {
	const page = Math.max(1, params.page ?? 1);
	const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
	const offset = (page - 1) * pageSize;

	const conditions = buildCrawlHistoryFilterConditions(params);
	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const [rows, countResult] = await Promise.all([
		db
			.select()
			.from(crawlHistory)
			.where(whereClause)
			.orderBy(desc(crawlHistory.started_at))
			.limit(pageSize)
			.offset(offset),
		db.select({ count: count() }).from(crawlHistory).where(whereClause),
	]);

	return {
		history: rows.map(toCrawlStatusResponse),
		total: Number(countResult[0]?.count ?? 0),
		page,
		pageSize,
	};
}
