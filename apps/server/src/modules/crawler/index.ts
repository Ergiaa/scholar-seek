import { Elysia, status, t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { authGuard } from "../../lib/auth-guard";
import {
	CreateScheduleBody,
	CrawlHistoryQuery,
	CrawlHistoryResponse,
	CrawlJobParams,
	CrawlOptionsBody,
	CrawlStatusResponse,
	ErrorResponse,
	OverrideRequiredResponse,
	RunEstimateResponse,
	RunIdParams,
	RunNowBody,
	RunResponse,
	ScheduleIdParams,
	ScheduleResponse,
	StartCrawlResponse,
	StatsResponse,
	UpdateScheduleBody,
} from "./model";
import { getCrawlHistory, getCrawlStatus, startCrawl } from "./service";
import {
	cancelRun,
	confirmRun,
	createSchedule,
	deleteSchedule,
	estimateRun,
	getRun,
	listSchedules,
	updateSchedule,
} from "./schedule-service";
import {
	ARXIV_TAXONOMY,
	DOAJ_LCC_TERMS,
	FIELDS_OF_STUDY,
} from "./source-taxonomies";
import { getStats } from "./stats-service";

export const crawlerModule = new Elysia({
	name: "module.crawler",
	prefix: "/api",
})
	.model({
		crawlOptionsBody: CrawlOptionsBody,
		startCrawlResponse: StartCrawlResponse,
		crawlStatusResponse: CrawlStatusResponse,
		crawlJobParams: CrawlJobParams,
		crawlHistoryQuery: CrawlHistoryQuery,
	})
	.post(
		"/crawl/start",
		async ({ body }) => {
			const result = await startCrawl(body);
			return { ...result, message: "Crawl queued successfully" };
		},
		{
			body: "crawlOptionsBody",
			response: {
				200: "startCrawlResponse",
			},
			detail: {
				summary: "Start a crawl job",
				description:
					"Enqueue a crawl job for the given source. Returns a jobId for polling status.",
				tags: ["crawler"],
			},
		}
	)
	.get(
		"/crawl/status/:jobId",
		async ({ params }) => {
			const result = await getCrawlStatus(params.jobId);
			if (!result) {
				return status(404, { error: "Job not found" });
			}
			return result;
		},
		{
			params: "crawlJobParams",
			response: {
				200: "crawlStatusResponse",
				404: t.Object({ error: t.String() }),
			},
			detail: {
				summary: "Get crawl job status",
				description: "Poll the status of a crawl job by its jobId.",
				tags: ["crawler"],
			},
		}
	)
	.get(
		"/crawl/history",
		({ query }) =>
			getCrawlHistory({
				source: query.source,
				status: query.status,
				since: query.since,
				until: query.until,
				page: query.page ? Number(query.page) : undefined,
				pageSize: query.pageSize ? Number(query.pageSize) : undefined,
			}),
		{
			query: "crawlHistoryQuery",
			response: {
				200: CrawlHistoryResponse,
			},
			detail: {
				summary: "List crawl history",
				description:
					"Paginated, filterable crawl job history, newest first. Filter " +
					"by source, status, and a date range on startedAt.",
				tags: ["crawler"],
			},
		}
	)
	.use(authGuard)
	.use(
		rateLimit({
			duration: 60_000,
			max: 60,
			generator: (req, server) =>
				server?.requestIP(req)?.address ??
				req.headers.get("x-forwarded-for") ??
				"unknown",
		})
	)
	.get(
		"/crawl/taxonomies",
		() => ({
			arxiv: ARXIV_TAXONOMY,
			doaj: DOAJ_LCC_TERMS,
			semanticScholar: FIELDS_OF_STUDY,
		}),
		{
			adminOnly: true,
			detail: {
				summary: "List category taxonomies for the schedule target picker",
				description:
					"Full native taxonomy per source — arXiv's 155 codes grouped by " +
					"archive, DOAJ's 538 LCC terms with their setSpec tokens, and " +
					"Semantic Scholar's canonical fields of study.",
				tags: ["crawler", "admin"],
			},
		}
	)
	.get("/crawl/stats", () => getStats(), {
		adminOnly: true,
		response: { 200: StatsResponse },
		detail: {
			summary: "Overview page stats",
			description:
				"Aggregated paper/schedule/run stats for the admin Overview page. " +
				"Cached for ~45s; invalidated proactively after every successful crawl.",
			tags: ["crawler", "admin"],
		},
	})
	.get("/crawl/schedules", () => listSchedules(), {
		adminOnly: true,
		response: { 200: t.Array(ScheduleResponse) },
		detail: {
			summary: "List crawl schedules",
			tags: ["crawler", "admin"],
		},
	})
	.post(
		"/crawl/schedules",
		({ body, user }) => createSchedule(body, user.id),
		{
			adminOnly: true,
			body: CreateScheduleBody,
			response: { 200: ScheduleResponse, 400: ErrorResponse },
			detail: {
				summary: "Create a crawl schedule",
				tags: ["crawler", "admin"],
			},
		}
	)
	.patch(
		"/crawl/schedules/:id",
		({ params, body }) => updateSchedule(params.id, body),
		{
			adminOnly: true,
			params: ScheduleIdParams,
			body: UpdateScheduleBody,
			response: { 200: ScheduleResponse, 400: ErrorResponse, 404: ErrorResponse },
			detail: {
				summary: "Update a crawl schedule",
				tags: ["crawler", "admin"],
			},
		}
	)
	.delete(
		"/crawl/schedules/:id",
		async ({ params }) => {
			await deleteSchedule(params.id);
			return { success: true };
		},
		{
			adminOnly: true,
			params: ScheduleIdParams,
			response: { 200: t.Object({ success: t.Boolean() }), 404: ErrorResponse },
			detail: {
				summary: "Soft-delete a crawl schedule",
				tags: ["crawler", "admin"],
			},
		}
	)
	.get(
		"/crawl/schedules/:id/run",
		({ params }) => estimateRun(params.id),
		{
			adminOnly: true,
			params: ScheduleIdParams,
			response: { 200: RunEstimateResponse, 404: ErrorResponse },
			detail: {
				summary: "Estimate the cost of running a schedule now",
				tags: ["crawler", "admin"],
			},
		}
	)
	.post(
		"/crawl/schedules/:id/run",
		({ params, body, user }) =>
			confirmRun(params.id, user, body.override),
		{
			adminOnly: true,
			params: ScheduleIdParams,
			body: RunNowBody,
			response: {
				200: RunResponse,
				400: ErrorResponse,
				404: ErrorResponse,
				409: ErrorResponse,
				428: OverrideRequiredResponse,
			},
			detail: {
				summary: "Run a schedule now",
				description:
					"Fans the schedule out into one crawl job per target. Requires " +
					"`override: true` if the estimated cost exceeds the configured " +
					"soft threshold, unless the caller is the root admin.",
				tags: ["crawler", "admin"],
			},
		}
	)
	.get(
		"/crawl/schedules/runs/:runId",
		({ params }) => getRun(params.runId),
		{
			adminOnly: true,
			params: RunIdParams,
			response: { 200: RunResponse, 404: ErrorResponse },
			detail: {
				summary: "Get a schedule run's status",
				tags: ["crawler", "admin"],
			},
		}
	)
	.post(
		"/crawl/schedules/runs/:runId/cancel",
		({ params }) => cancelRun(params.runId),
		{
			adminOnly: true,
			params: RunIdParams,
			response: { 200: RunResponse, 404: ErrorResponse, 409: ErrorResponse },
			detail: {
				summary: "Cancel an in-progress schedule run",
				description:
					"Removes not-yet-started jobs for the run. A job already " +
					"executing finishes naturally.",
				tags: ["crawler", "admin"],
			},
		}
	);
