import { Elysia, t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import {
	ErrorResponse,
	JournalsResponse,
	PaperParams,
	PaperResponse,
	RelatedQuery,
	SearchQuery,
	SearchResult,
} from "./model";
import {
	getJournals,
	getPaper,
	getRelatedPapers,
	searchPapers,
} from "./service";

export const papersModule = new Elysia({
	name: "module.papers",
	prefix: "/api",
})
	.use(
		rateLimit({
			duration: 60_000,
			max: 100,
			generator: (req, server) =>
				server?.requestIP(req)?.address ??
				req.headers.get("x-forwarded-for") ??
				req.headers.get("x-real-ip") ??
				"unknown",
		})
	)
	.model({
		paper: PaperResponse,
		searchResult: SearchResult,
		searchQuery: SearchQuery,
		error: ErrorResponse,
		journals: JournalsResponse,
		relatedQuery: RelatedQuery,
		paperParams: PaperParams,
	})
	.get(
		"/papers",
		async ({ query }) => {
			const params = {
				q: query.q,
				page: query.page ? Number(query.page) : undefined,
				pageSize: query.pageSize ? Number(query.pageSize) : undefined,
				sortBy: query.sortBy,
				author: query.author,
				journal: query.journal,
				keyword: query.keyword,
				yearFrom: query.yearFrom ? Number(query.yearFrom) : undefined,
				yearTo: query.yearTo ? Number(query.yearTo) : undefined,
			};

			return await searchPapers(params);
		},
		{
			query: "searchQuery",
			response: {
				200: "searchResult",
				500: "error",
			},
			detail: {
				summary: "Search papers",
				description:
					"Search papers with full-text search, filters, pagination, and facets",
				tags: ["papers"],
			},
		}
	)
	.get("/papers/:id", async ({ params }) => await getPaper(params.id), {
		params: "paperParams",
		response: {
			200: "paper",
			404: "error",
		},
		detail: {
			summary: "Get paper by ID",
			description: "Retrieve a single paper by its UUID",
			tags: ["papers"],
		},
	})
	.get(
		"/papers/:id/related",
		async ({ params, query }) => {
			const limit = query.limit ? Number(query.limit) : 5;
			return await getRelatedPapers(params.id, limit);
		},
		{
			params: "paperParams",
			query: "relatedQuery",
			response: {
				200: t.Array(PaperResponse),
			},
			detail: {
				summary: "Get related papers",
				description:
					"Find papers related to the specified paper by shared keywords",
				tags: ["papers"],
			},
		}
	)
	.get("/journals", () => getJournals(), {
		response: {
			200: "journals",
		},
		detail: {
			summary: "Get all journals",
			description: "Get a list of all unique journal names for facet filtering",
			tags: ["journals"],
		},
	});
