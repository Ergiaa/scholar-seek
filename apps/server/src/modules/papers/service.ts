import { db } from "@scholar-seek/db";
import type { Paper } from "@scholar-seek/db/schema/papers";
import { papers } from "@scholar-seek/db/schema/papers";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { status } from "elysia";
import { cacheGet, cacheSet } from "../../lib/cache";
import type {
	FacetItemType,
	FacetsType,
	PaperResponseType,
	SearchResultType,
	SortByType,
} from "./model";

type FacetRow = Pick<
	Paper,
	"authors" | "keywords" | "journal" | "published_at"
>;

function toPaperResponse(paper: Paper): PaperResponseType {
	return {
		id: paper.id,
		title: paper.title,
		abstract: paper.abstract,
		authors: paper.authors,
		publishedAt: paper.published_at?.toISOString() ?? null,
		journal: paper.journal,
		doi: paper.doi,
		keywords: paper.keywords,
		sourceUrl: paper.source_url,
	};
}

function parseArrayParam(
	param: string | string[] | undefined
): string[] | undefined {
	if (!param) {
		return undefined;
	}
	if (Array.isArray(param)) {
		return param;
	}
	return [param];
}

function buildFacets(papersList: FacetRow[]): FacetsType {
	const journalCounts = new Map<string, number>();
	const keywordCounts = new Map<string, number>();
	const authorCounts = new Map<string, number>();
	const yearCounts = new Map<string, number>();

	for (const paper of papersList) {
		if (paper.journal) {
			journalCounts.set(
				paper.journal,
				(journalCounts.get(paper.journal) ?? 0) + 1
			);
		}

		if (paper.keywords) {
			for (const keyword of paper.keywords) {
				keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
			}
		}

		for (const author of paper.authors) {
			authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
		}

		if (paper.published_at) {
			const year = paper.published_at.getFullYear().toString();
			yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
		}
	}

	const toFacetItems = (map: Map<string, number>): FacetItemType[] =>
		Array.from(map.entries())
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count);

	return {
		journals: toFacetItems(journalCounts),
		keywords: toFacetItems(keywordCounts),
		authors: toFacetItems(authorCounts),
		years: toFacetItems(yearCounts),
	};
}

function buildOrderBy(sortBy: SortByType) {
	switch (sortBy) {
		case "date_desc":
			return desc(papers.published_at);
		case "date_asc":
			return asc(papers.published_at);
		case "title_asc":
			return asc(papers.title);
		case "author_asc":
			return sql`${papers.authors}->>0 asc`;
		default:
			return undefined;
	}
}

function searchCacheKey(params: object): string {
	return `papers:search:${JSON.stringify(params)}`;
}

export async function searchPapers(params: {
	q?: string;
	page?: number;
	pageSize?: number;
	sortBy?: SortByType;
	author?: string;
	journal?: string | string[];
	keyword?: string | string[];
	yearFrom?: number;
	yearTo?: number;
}): Promise<SearchResultType> {
	const cacheKey = searchCacheKey(params);
	const cached = await cacheGet<SearchResultType>(cacheKey);
	if (cached) {
		return cached;
	}
	const page = Math.max(1, params.page ?? 1);
	const pageSize = [10, 20, 50].includes(params.pageSize ?? 20)
		? (params.pageSize ?? 20)
		: 20;
	const sortBy: SortByType = params.sortBy ?? "relevance";

	// Search-only condition — used for facet computation so facets always
	// reflect the full result set for the query, not the active filters.
	const searchConditions: (SQL | undefined)[] = [];

	if (params.q) {
		const searchPattern = `%${params.q.toLowerCase()}%`;
		searchConditions.push(
			or(
				ilike(papers.title, searchPattern),
				ilike(papers.abstract, searchPattern),
				sql`${papers.authors}::text ilike ${searchPattern}`,
				sql`${papers.keywords}::text ilike ${searchPattern}`,
				ilike(papers.journal, searchPattern)
			)
		);
	}

	const searchOnlyWhereClause =
		searchConditions.length > 0 ? and(...searchConditions) : undefined;

	// Filter conditions — applied on top of the search for paginated results.
	const filterConditions: (SQL | undefined)[] = [...searchConditions];

	if (params.author) {
		filterConditions.push(
			sql`${papers.authors}::text ilike ${`%"${params.author}%"`}`
		);
	}

	const journals = parseArrayParam(params.journal);
	if (journals && journals.length > 0) {
		filterConditions.push(inArray(papers.journal, journals));
	}

	const keywords = parseArrayParam(params.keyword);
	if (keywords && keywords.length > 0) {
		filterConditions.push(
			or(
				...keywords.map(
					(k) => sql`${papers.keywords}::jsonb @> ${JSON.stringify([k])}::jsonb`
				)
			)
		);
	}

	if (params.yearFrom !== undefined) {
		filterConditions.push(
			gte(papers.published_at, new Date(`${params.yearFrom}-01-01`))
		);
	}

	if (params.yearTo !== undefined) {
		filterConditions.push(
			lte(papers.published_at, new Date(`${params.yearTo}-12-31`))
		);
	}

	const whereClause =
		filterConditions.length > 0 ? and(...filterConditions) : undefined;

	const offset = (page - 1) * pageSize;
	const orderBy = buildOrderBy(sortBy);

	const [paginatedRows, countResult, facetRows] = await Promise.all([
		orderBy
			? db
					.select()
					.from(papers)
					.where(whereClause)
					.orderBy(orderBy)
					.limit(pageSize)
					.offset(offset)
			: db
					.select()
					.from(papers)
					.where(whereClause)
					.limit(pageSize)
					.offset(offset),
		db.select({ count: count() }).from(papers).where(whereClause),
		db
			.select({
				authors: papers.authors,
				keywords: papers.keywords,
				journal: papers.journal,
				published_at: papers.published_at,
			})
			.from(papers)
			.where(searchOnlyWhereClause),
	]);

	const total = Number(countResult[0]?.count ?? 0);
	const facets = buildFacets(facetRows);

	const result: SearchResultType = {
		papers: paginatedRows.map(toPaperResponse),
		total,
		page,
		pageSize,
		facets,
	};

	await cacheSet(searchCacheKey(params), result, 300);
	return result;
}

export async function getPaper(id: string): Promise<PaperResponseType> {
	const cacheKey = `papers:id:${id}`;
	const cached = await cacheGet<PaperResponseType>(cacheKey);
	if (cached) {
		return cached;
	}

	const [paper] = await db.select().from(papers).where(eq(papers.id, id));

	if (!paper) {
		throw status(404, "Paper not found");
	}

	const result = toPaperResponse(paper);
	await cacheSet(cacheKey, result, 1800);
	return result;
}

export async function getRelatedPapers(
	id: string,
	limit = 5
): Promise<PaperResponseType[]> {
	const [sourcePaper] = await db.select().from(papers).where(eq(papers.id, id));

	if (!sourcePaper?.keywords?.length) {
		return [];
	}

	const keywords = sourcePaper.keywords;

	const relatedPapers = await db
		.select()
		.from(papers)
		.where(
			and(
				sql`${papers.id} != ${id}`,
				or(
					...keywords.map(
						(k) =>
							sql`${papers.keywords}::jsonb @> ${JSON.stringify([k])}::jsonb`
					)
				)
			)
		)
		.limit(limit);

	return relatedPapers.map(toPaperResponse);
}

export async function getJournals(): Promise<string[]> {
	const cacheKey = "journals:all";
	const cached = await cacheGet<string[]>(cacheKey);
	if (cached) {
		return cached;
	}

	const result = await db
		.selectDistinct({ journal: papers.journal })
		.from(papers)
		.where(sql`${papers.journal} IS NOT NULL`)
		.orderBy(asc(papers.journal));

	const journals = result
		.map((r) => r.journal)
		.filter((j): j is string => j !== null);

	await cacheSet(cacheKey, journals, 3600);
	return journals;
}
