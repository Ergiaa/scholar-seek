import { t } from "elysia";

export const CrawlSource = t.Union([
	t.Literal("arxiv"),
	t.Literal("semantic_scholar"),
	t.Literal("doaj"),
]);

export const CrawlOptionsBody = t.Object({
	source: t.Optional(CrawlSource),
	// Search query — required when source is "semantic_scholar"
	query: t.Optional(t.String({ maxLength: 300 })),
	since: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
	until: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
	categories: t.Optional(
		t.Array(t.String({ maxLength: 50 }), { maxItems: 20 })
	),
	maxRecords: t.Optional(t.Number({ minimum: 1, maximum: 50_000 })),
});

export const StartCrawlResponse = t.Object({
	jobId: t.String(),
	historyId: t.String(),
	message: t.String(),
});

export const CrawlStatusResponse = t.Object({
	jobId: t.String(),
	historyId: t.String(),
	source: t.String(),
	status: t.Union([
		t.Literal("running"),
		t.Literal("completed"),
		t.Literal("failed"),
		t.Literal("waiting"),
		t.Literal("unknown"),
	]),
	papersFound: t.Number(),
	papersInserted: t.Number(),
	papersSkipped: t.Number(),
	errors: t.Array(t.String()),
	startedAt: t.String(),
	completedAt: t.Union([t.String(), t.Null()]),
	durationMs: t.Union([t.Number(), t.Null()]),
});

export const CrawlJobParams = t.Object({
	jobId: t.String(),
});

export const CrawlHistoryQuery = t.Object({
	limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export type CrawlOptionsBodyType = typeof CrawlOptionsBody.static;
export type StartCrawlResponseType = typeof StartCrawlResponse.static;
export type CrawlStatusResponseType = typeof CrawlStatusResponse.static;
