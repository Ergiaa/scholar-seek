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
	// DOAJ LCC term labels run well past 50 chars (e.g. "Law in general.
	// Comparative and uniform law. Jurisprudence") — 100 covers the longest
	// entry in DOAJ_LCC_TERMS with headroom.
	categories: t.Optional(
		t.Array(t.String({ maxLength: 100 }), { maxItems: 20 })
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
	scheduleId: t.Union([t.String(), t.Null()]),
	scheduleName: t.Union([t.String(), t.Null()]),
	options: t.Union([t.Record(t.String(), t.Unknown()), t.Null()]),
});

export const CrawlJobParams = t.Object({
	jobId: t.String(),
});

export const CrawlHistoryQuery = t.Object({
	source: t.Optional(CrawlSource),
	status: t.Optional(
		t.Union([t.Literal("running"), t.Literal("completed"), t.Literal("failed")])
	),
	since: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
	until: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
	page: t.Optional(t.Numeric({ minimum: 1 })),
	pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const CrawlHistoryResponse = t.Object({
	history: t.Array(CrawlStatusResponse),
	total: t.Number(),
	page: t.Number(),
	pageSize: t.Number(),
});

export type CrawlOptionsBodyType = typeof CrawlOptionsBody.static;
export type StartCrawlResponseType = typeof StartCrawlResponse.static;
export type CrawlStatusResponseType = typeof CrawlStatusResponse.static;

// --- Schedule management ---

export const ScheduleTargetBody = t.Object({
	label: t.String({ minLength: 1, maxLength: 255 }),
	source: CrawlSource,
	query: t.Optional(t.String({ maxLength: 300 })),
	// DOAJ LCC term labels run well past 50 chars (e.g. "Law in general.
	// Comparative and uniform law. Jurisprudence") — 100 covers the longest
	// entry in DOAJ_LCC_TERMS with headroom.
	categories: t.Optional(
		t.Array(t.String({ maxLength: 100 }), { maxItems: 20 })
	),
	maxRecords: t.Number({ minimum: 1, maximum: 50_000 }),
});

export const CreateScheduleBody = t.Object({
	name: t.String({ minLength: 1, maxLength: 255 }),
	cronPattern: t.String({ minLength: 1, maxLength: 100 }),
	targets: t.Array(ScheduleTargetBody, { minItems: 1, maxItems: 100 }),
});

export const UpdateScheduleBody = t.Object({
	name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
	cronPattern: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
	enabled: t.Optional(t.Boolean()),
	targets: t.Optional(
		t.Array(ScheduleTargetBody, { minItems: 1, maxItems: 100 })
	),
});

export const ScheduleIdParams = t.Object({
	id: t.String(),
});

export const RunIdParams = t.Object({
	runId: t.String(),
});

export const ScheduleTargetResponse = t.Object({
	id: t.String(),
	label: t.String(),
	source: t.String(),
	query: t.Union([t.String(), t.Null()]),
	categories: t.Union([t.Array(t.String()), t.Null()]),
	maxRecords: t.Number(),
});

export const ScheduleResponse = t.Object({
	id: t.String(),
	name: t.String(),
	cronPattern: t.String(),
	enabled: t.Boolean(),
	createdBy: t.Union([t.String(), t.Null()]),
	createdAt: t.String(),
	updatedAt: t.String(),
	targets: t.Array(ScheduleTargetResponse),
	lastRun: t.Union([
		t.Object({
			id: t.String(),
			status: t.String(),
			startedAt: t.String(),
			completedAt: t.Union([t.String(), t.Null()]),
		}),
		t.Null(),
	]),
});

export const RunEstimateResponse = t.Object({
	scheduleId: t.String(),
	targetCount: t.Number(),
	totalRequestsEstimate: t.Number(),
	estimatedSeconds: t.Number(),
	requiresOverride: t.Boolean(),
	sharedPoolWarning: t.Boolean(),
});

export const ErrorResponse = t.Object({ error: t.String() });

export const OverrideRequiredResponse = t.Object({
	error: t.String(),
	scheduleId: t.String(),
	targetCount: t.Number(),
	totalRequestsEstimate: t.Number(),
	estimatedSeconds: t.Number(),
	requiresOverride: t.Boolean(),
	sharedPoolWarning: t.Boolean(),
});

export const RunNowBody = t.Object({
	override: t.Optional(t.Boolean()),
});

export const RunResponse = t.Object({
	id: t.String(),
	scheduleId: t.String(),
	status: t.String(),
	targetCount: t.Number(),
	completedCount: t.Number(),
	failedCount: t.Number(),
	totalRequestsEstimate: t.Number(),
	startedAt: t.String(),
	completedAt: t.Union([t.String(), t.Null()]),
	cancelledAt: t.Union([t.String(), t.Null()]),
});

// --- Stats (Overview page) ---

export const StatsAttentionItem = t.Object({
	scheduleId: t.String(),
	scheduleName: t.String(),
	status: t.String(),
	startedAt: t.String(),
	reason: t.Union([t.Literal("failed"), t.Literal("running_past_estimate")]),
});

export const StatsResponse = t.Object({
	totalPapers: t.Number(),
	papersAdded24h: t.Number(),
	papersAdded7d: t.Number(),
	embeddingCoveragePercent: t.Number(),
	bySource: t.Array(
		t.Object({ source: t.Union([t.String(), t.Null()]), count: t.Number() })
	),
	activeSchedules: t.Number(),
	runningNow: t.Number(),
	recentActivity: t.Array(CrawlStatusResponse),
	attention: t.Array(StatsAttentionItem),
});

export type ScheduleTargetBodyType = typeof ScheduleTargetBody.static;
export type CreateScheduleBodyType = typeof CreateScheduleBody.static;
export type UpdateScheduleBodyType = typeof UpdateScheduleBody.static;
export type ScheduleResponseType = typeof ScheduleResponse.static;
export type RunEstimateResponseType = typeof RunEstimateResponse.static;
export type RunResponseType = typeof RunResponse.static;
export type StatsResponseType = typeof StatsResponse.static;
