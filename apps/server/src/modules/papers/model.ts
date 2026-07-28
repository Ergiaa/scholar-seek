import { t } from "elysia";

export const PaperResponse = t.Object({
	id: t.String(),
	title: t.String(),
	abstract: t.Union([t.String(), t.Null()]),
	authors: t.Array(t.String()),
	publishedAt: t.Union([t.String(), t.Null()]),
	journal: t.Union([t.String(), t.Null()]),
	doi: t.Union([t.String(), t.Null()]),
	keywords: t.Union([t.Array(t.String()), t.Null()]),
	sourceUrl: t.String(),
});

export const FacetItem = t.Object({
	value: t.String(),
	count: t.Number(),
});

export const Facets = t.Object({
	journals: t.Array(FacetItem),
	keywords: t.Array(FacetItem),
	authors: t.Array(FacetItem),
	years: t.Array(FacetItem),
	sources: t.Array(FacetItem),
});

export const SearchResult = t.Object({
	papers: t.Array(PaperResponse),
	total: t.Number(),
	page: t.Number(),
	pageSize: t.Number(),
	facets: Facets,
	subqueries: t.Optional(t.Array(t.String())),
});

export const ErrorResponse = t.Object({
	error: t.String(),
});

export const SortBy = t.Union([
	t.Literal("relevance"),
	t.Literal("date_desc"),
	t.Literal("date_asc"),
	t.Literal("title_asc"),
	t.Literal("author_asc"),
]);

// Which column(s) the free-text query is matched against
export const SearchIn = t.Union([
	t.Literal("all"),
	t.Literal("title"),
	t.Literal("abstract"),
	t.Literal("keywords"),
]);

export const SearchMode = t.Union([t.Literal("standard"), t.Literal("ml")]);

export const SearchQuery = t.Object({
	q: t.Optional(t.String({ maxLength: 200 })),
	searchIn: t.Optional(SearchIn),
	searchMode: t.Optional(SearchMode),
	// Field of study (e.g. "Computer Science") — matched against Semantic
	// Scholar field names and mapped arXiv category prefixes
	field: t.Optional(t.String({ maxLength: 100 })),
	// Repository the paper was crawled from (e.g. "arxiv")
	source: t.Optional(
		t.Union([
			t.String({ maxLength: 100 }),
			t.Array(t.String({ maxLength: 100 })),
		])
	),
	page: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
	pageSize: t.Optional(t.Numeric()),
	sortBy: t.Optional(SortBy),
	author: t.Optional(t.String({ maxLength: 200 })),
	journal: t.Optional(
		t.Union([
			t.String({ maxLength: 200 }),
			t.Array(t.String({ maxLength: 200 })),
		])
	),
	keyword: t.Optional(
		t.Union([
			t.String({ maxLength: 200 }),
			t.Array(t.String({ maxLength: 200 })),
		])
	),
	yearFrom: t.Optional(t.Numeric({ minimum: 1900, maximum: 2100 })),
	yearTo: t.Optional(t.Numeric({ minimum: 1900, maximum: 2100 })),
});

export const RelatedQuery = t.Object({
	limit: t.Optional(t.Numeric()),
});

export const PaperParams = t.Object({
	id: t.String(),
});

export const JournalsResponse = t.Array(t.String());

export type PaperResponseType = typeof PaperResponse.static;
export type SearchInType = typeof SearchIn.static;
export type FacetItemType = typeof FacetItem.static;
export type FacetsType = typeof Facets.static;
export type SearchResultType = typeof SearchResult.static;
export type SortByType = typeof SortBy.static;
export type SearchModeType = typeof SearchMode.static;
