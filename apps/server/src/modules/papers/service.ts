import { db } from "@scholar-seek/db";
import type { Paper } from "@scholar-seek/db/schema/papers";
import { papers } from "@scholar-seek/db/schema/papers";
import { env } from "@scholar-seek/env/server";
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
import { fieldCondition, isFieldOfStudy } from "./fields";
import type {
  FacetItemType,
  FacetsType,
  PaperResponseType,
  SearchInType,
  SearchResultType,
  SortByType,
} from "./model";

type FacetRow = Pick<
  Paper,
  "authors" | "keywords" | "journal" | "published_at" | "source"
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
  const sourceCounts = new Map<string, number>();

  for (const paper of papersList) {
    if (paper.source) {
      sourceCounts.set(paper.source, (sourceCounts.get(paper.source) ?? 0) + 1);
    }

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
    sources: toFacetItems(sourceCounts),
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

function buildSearchCondition(
  q: string,
  searchIn: SearchInType
): SQL | undefined {
  const searchPattern = `%${q.toLowerCase()}%`;

  switch (searchIn) {
    case "title":
      return ilike(papers.title, searchPattern);
    case "abstract":
      return ilike(papers.abstract, searchPattern);
    case "keywords":
      return sql`${papers.keywords}::text ilike ${searchPattern}`;
    default:
      return or(
        ilike(papers.title, searchPattern),
        ilike(papers.abstract, searchPattern),
        sql`${papers.authors}::text ilike ${searchPattern}`,
        sql`${papers.keywords}::text ilike ${searchPattern}`,
        ilike(papers.journal, searchPattern)
      );
  }
}

interface SearchPapersParams {
  author?: string;
  field?: string;
  journal?: string | string[];
  keyword?: string | string[];
  page?: number;
  pageSize?: number;
  q?: string;
  searchIn?: SearchInType;
  sortBy?: SortByType;
  source?: string | string[];
  yearFrom?: number;
  yearTo?: number;
}

/** Result-filter conditions applied on top of the search conditions. */
function buildFilterConditions(
  params: SearchPapersParams
): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [];

  if (params.author) {
    conditions.push(
      sql`${papers.authors}::text ilike ${`%"${params.author}%"`}`
    );
  }

  const journals = parseArrayParam(params.journal);
  if (journals && journals.length > 0) {
    conditions.push(inArray(papers.journal, journals));
  }

  const keywords = parseArrayParam(params.keyword);
  if (keywords && keywords.length > 0) {
    conditions.push(
      or(
        ...keywords.map(
          (k) => sql`${papers.keywords}::jsonb @> ${JSON.stringify([k])}::jsonb`
        )
      )
    );
  }

  const sources = parseArrayParam(params.source);
  if (sources && sources.length > 0) {
    conditions.push(inArray(papers.source, sources));
  }

  if (params.yearFrom !== undefined) {
    conditions.push(
      gte(papers.published_at, new Date(`${params.yearFrom}-01-01`))
    );
  }

  if (params.yearTo !== undefined) {
    conditions.push(
      lte(papers.published_at, new Date(`${params.yearTo}-12-31`))
    );
  }

  return conditions;
}

export async function searchPapers(
  params: SearchPapersParams
): Promise<SearchResultType> {
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
  // The field-of-study input is part of the search form (not a result
  // filter), so it scopes facets too.
  const searchConditions: (SQL | undefined)[] = [];

  if (params.q) {
    searchConditions.push(
      buildSearchCondition(params.q, params.searchIn ?? "all")
    );
  }

  if (params.field && isFieldOfStudy(params.field)) {
    searchConditions.push(fieldCondition(params.field));
  }

  const searchOnlyWhereClause =
    searchConditions.length > 0 ? and(...searchConditions) : undefined;

  // Filter conditions — applied on top of the search for paginated results.
  const filterConditions: (SQL | undefined)[] = [
    ...searchConditions,
    ...buildFilterConditions(params),
  ];

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
        source: papers.source,
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

interface MlPaperResult {
  id: string;
  title: string;
  abstract: string | null;
  authors: string[];
  journal: string | null;
  published_at: string | null;
  doi: string | null;
  source_url: string | null;
  keywords: string[] | null;
}

interface MlSearchResponse {
  results: MlPaperResult[];
  subqueries: string[];
}


export async function mlSearchPapers(
  params: SearchPapersParams,
): Promise<SearchResultType> {
  const { q } = params;
  if (!q) {
    return { papers: [], total: 0, page: 1, pageSize: 20, facets: { journals: [], keywords: [], authors: [], years: [], sources: [] } };
  }

  const cacheKey = `papers:ml:${JSON.stringify(params)}`;
  const cached = await cacheGet<SearchResultType>(cacheKey);
  if (cached) {
    return cached;
  }

  const safePage = Math.max(1, params.page ?? 1);
  const safePageSize = [10, 20, 50].includes(params.pageSize ?? 20) ? (params.pageSize ?? 20) : 20;

  const mlUrl = env.ML_SERVICE_URL ?? "http://localhost:8000";
  const resp = await fetch(`${mlUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, limit: 100, search_in: params.searchIn ?? "all" }),
  });

  if (!resp.ok) {
    throw new Error(`ML service returned ${resp.status}: ${await resp.text()}`);
  }

  const mlData = (await resp.json()) as MlSearchResponse;
  const orderedIds = mlData.results.map((r) => r.id);

  if (orderedIds.length === 0) {
    return { papers: [], total: 0, page: safePage, pageSize: safePageSize, facets: { journals: [], keywords: [], authors: [], years: [], sources: [] }, subqueries: mlData.subqueries };
  }

  // Field-of-study scopes both facets and results (same behaviour as standard search).
  const fieldFilter = params.field && isFieldOfStudy(params.field) ? fieldCondition(params.field) : undefined;

  // Facet scope: ML result set + field filter only (no result filters).
  const facetWhereClause = and(inArray(papers.id, orderedIds), fieldFilter);

  // Result scope: ML result set + field filter + all result filters.
  const resultFilterConditions: (SQL | undefined)[] = [
    inArray(papers.id, orderedIds),
    fieldFilter,
    ...buildFilterConditions(params),
  ];
  const resultWhereClause = and(...resultFilterConditions);

  const [facetRows, filteredRows] = await Promise.all([
    db
      .select({
        authors: papers.authors,
        keywords: papers.keywords,
        journal: papers.journal,
        published_at: papers.published_at,
        source: papers.source,
      })
      .from(papers)
      .where(facetWhereClause),
    db.select().from(papers).where(resultWhereClause),
  ]);

  // Sort by explicit sortBy if provided, otherwise restore ML relevance order.
  if (params.sortBy && params.sortBy !== "relevance") {
    const orderBy = buildOrderBy(params.sortBy);
    if (orderBy) {
      // Apply in-memory sort matching the DB expressions.
      filteredRows.sort((a, b) => {
        switch (params.sortBy) {
          case "date_desc":
            return (b.published_at?.getTime() ?? 0) - (a.published_at?.getTime() ?? 0);
          case "date_asc":
            return (a.published_at?.getTime() ?? 0) - (b.published_at?.getTime() ?? 0);
          case "title_asc":
            return a.title.localeCompare(b.title);
          case "author_asc":
            return (a.authors[0] ?? "").localeCompare(b.authors[0] ?? "");
          default:
            return 0;
        }
      });
    }
  } else {
    const rankMap = new Map(orderedIds.map((id, i) => [id, i]));
    filteredRows.sort((a, b) => (rankMap.get(a.id) ?? Infinity) - (rankMap.get(b.id) ?? Infinity));
  }

  const total = filteredRows.length;
  const offset = (safePage - 1) * safePageSize;
  const paginated = filteredRows.slice(offset, offset + safePageSize);

  const result: SearchResultType = {
    papers: paginated.map(toPaperResponse),
    total,
    page: safePage,
    pageSize: safePageSize,
    facets: buildFacets(facetRows),
    subqueries: mlData.subqueries,
  };

  await cacheSet(cacheKey, result, 120);
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
