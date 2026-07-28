import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Paper } from "@scholar-seek/db/schema/papers";
import {
	buildFacets,
	buildFilterConditions,
	buildOrderBy,
	buildSearchCondition,
	parseArrayParam,
	searchCacheKey,
	toPaperResponse,
} from "./service";

function makePaper(overrides: Partial<Paper> = {}): Paper {
	return {
		id: "00000000-0000-0000-0000-000000000000",
		title: "A Paper",
		abstract: "An abstract",
		authors: ["Ada Lovelace"],
		published_at: new Date("2020-05-01T00:00:00.000Z"),
		journal: "Journal of Things",
		doi: "10.1234/abc",
		keywords: ["Computer Science"],
		source_url: "https://example.com/paper",
		source: "arxiv",
		source_id: "1234.5678",
		citation_count: 0,
		embedding_stored: false,
		created_at: new Date("2020-05-02T00:00:00.000Z"),
		...overrides,
	};
}

describe("parseArrayParam", () => {
	it("returns undefined for undefined input", () => {
		expect(parseArrayParam(undefined)).toBeUndefined();
	});

	it("wraps a single string in an array", () => {
		expect(parseArrayParam("a")).toEqual(["a"]);
	});

	it("passes arrays through unchanged", () => {
		expect(parseArrayParam(["a", "b"])).toEqual(["a", "b"]);
	});
});

describe("toPaperResponse", () => {
	it("maps published_at to an ISO string when present", () => {
		const result = toPaperResponse(makePaper());
		expect(result.publishedAt).toBe("2020-05-01T00:00:00.000Z");
	});

	it("maps a null published_at to null", () => {
		const result = toPaperResponse(makePaper({ published_at: null }));
		expect(result.publishedAt).toBeNull();
	});
});

describe("buildFacets", () => {
	it("counts and sorts authors, journals, keywords, years, and sources descending", () => {
		const rows = [
			makePaper({
				authors: ["A", "B"],
				journal: "J1",
				keywords: ["k1"],
				published_at: new Date("2020-01-01"),
				source: "arxiv",
			}),
			makePaper({
				authors: ["A"],
				journal: "J1",
				keywords: ["k1", "k2"],
				published_at: new Date("2020-06-01"),
				source: "arxiv",
			}),
			makePaper({
				authors: ["C"],
				journal: "J2",
				keywords: ["k2"],
				published_at: new Date("2021-01-01"),
				source: "doaj",
			}),
		];

		const facets = buildFacets(rows);

		expect(facets.authors).toEqual([
			{ value: "A", count: 2 },
			{ value: "B", count: 1 },
			{ value: "C", count: 1 },
		]);
		expect(facets.journals).toEqual([
			{ value: "J1", count: 2 },
			{ value: "J2", count: 1 },
		]);
		expect(facets.keywords).toEqual([
			{ value: "k1", count: 2 },
			{ value: "k2", count: 2 },
		]);
		expect(facets.years).toEqual([
			{ value: "2020", count: 2 },
			{ value: "2021", count: 1 },
		]);
		expect(facets.sources).toEqual([
			{ value: "arxiv", count: 2 },
			{ value: "doaj", count: 1 },
		]);
	});

	it("skips null journal, keywords, source, and published_at", () => {
		const rows = [
			makePaper({
				journal: null,
				keywords: null,
				source: null,
				published_at: null,
			}),
		];

		const facets = buildFacets(rows);

		expect(facets.journals).toEqual([]);
		expect(facets.keywords).toEqual([]);
		expect(facets.sources).toEqual([]);
		expect(facets.years).toEqual([]);
	});
});

describe("buildOrderBy", () => {
	it("returns a defined clause for date_desc, date_asc, title_asc, and author_asc", () => {
		expect(buildOrderBy("date_desc")).toBeDefined();
		expect(buildOrderBy("date_asc")).toBeDefined();
		expect(buildOrderBy("title_asc")).toBeDefined();
		expect(buildOrderBy("author_asc")).toBeDefined();
	});

	it("returns undefined for relevance", () => {
		expect(buildOrderBy("relevance")).toBeUndefined();
	});
});

describe("buildSearchCondition", () => {
	it("returns a defined condition for title, abstract, keywords, and all", () => {
		expect(buildSearchCondition("neural nets", "title")).toBeDefined();
		expect(buildSearchCondition("neural nets", "abstract")).toBeDefined();
		expect(buildSearchCondition("neural nets", "keywords")).toBeDefined();
		expect(buildSearchCondition("neural nets", "all")).toBeDefined();
	});
});

describe("buildFilterConditions", () => {
	it("returns no conditions for empty params", () => {
		expect(buildFilterConditions({})).toEqual([]);
	});

	it("returns a condition for each provided filter", () => {
		const conditions = buildFilterConditions({
			author: "Ada Lovelace",
			journal: ["J1", "J2"],
			keyword: "ml",
			source: "arxiv",
			yearFrom: 2020,
			yearTo: 2021,
		});

		expect(conditions).toHaveLength(6);
		for (const condition of conditions) {
			expect(condition).toBeDefined();
		}
	});
});

describe("searchCacheKey", () => {
	it("produces a stable key for the same params", () => {
		const params = { q: "test", page: 1 };
		expect(searchCacheKey(params)).toBe(searchCacheKey({ ...params }));
	});

	it("produces different keys for different params", () => {
		expect(searchCacheKey({ q: "a" })).not.toBe(searchCacheKey({ q: "b" }));
	});
});

describe("searchPapers / getPaper orchestration", () => {
	const cacheGet = mock<(key: string) => Promise<unknown>>();
	const cacheSet = mock<(...args: unknown[]) => Promise<void>>();
	const dbSelect = mock<(...args: unknown[]) => unknown>();

	mock.module("../../lib/cache", () => ({
		cacheGet,
		cacheSet,
		cacheDel: mock<() => Promise<void>>(),
	}));

	mock.module("@scholar-seek/db", () => ({
		db: {
			select: dbSelect,
			selectDistinct: dbSelect,
		},
	}));

	beforeEach(() => {
		cacheGet.mockReset();
		cacheSet.mockReset();
		dbSelect.mockReset();
	});

	it("returns the cached result directly without querying the db", async () => {
		const cached = {
			papers: [],
			total: 0,
			page: 1,
			pageSize: 20,
			facets: {
				journals: [],
				keywords: [],
				authors: [],
				years: [],
				sources: [],
			},
		};
		cacheGet.mockResolvedValueOnce(cached);

		const { searchPapers } = await import("./service");
		const result = await searchPapers({ q: "cached query" });

		expect(result).toEqual(cached);
		expect(dbSelect).not.toHaveBeenCalled();
	});

	it("getPaper throws a 404 when the db returns no rows", async () => {
		cacheGet.mockResolvedValueOnce(null);
		dbSelect.mockReturnValueOnce({
			from: () => ({
				where: () => Promise.resolve([]),
			}),
		});

		const { getPaper } = await import("./service");
		await expect(getPaper("missing-id")).rejects.toBeDefined();
	});
});
