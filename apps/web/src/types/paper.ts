export interface Paper {
	abstract: string | null;
	authors: string[];
	doi: string | null;
	id: string;
	journal: string | null;
	keywords: string[] | null;
	publishedAt: string;
	sourceUrl: string;
	title: string;
}

export type SortBy =
	| "relevance"
	| "date_desc"
	| "date_asc"
	| "title_asc"
	| "author_asc";

export type SearchIn = "all" | "title" | "abstract" | "keywords";

export type SearchMode = "standard" | "ml";

export interface SearchParams {
	authorFilter?: string;
	field?: string;
	journalFilter?: string[];
	keywordFilter?: string[];
	page?: number;
	pageSize?: number;
	q?: string;
	searchIn?: SearchIn;
	searchMode?: SearchMode;
	sortBy?: SortBy;
	sourceFilter?: string[];
	yearFrom?: number;
	yearTo?: number;
}

export interface FacetItem {
	count: number;
	value: string;
}

export interface Facets {
	authors: FacetItem[];
	journals: FacetItem[];
	keywords: FacetItem[];
	sources: FacetItem[];
	years: FacetItem[];
}

export interface SearchResult {
	facets: Facets;
	page: number;
	pageSize: number;
	papers: Paper[];
	subqueries?: string[];
	total: number;
}
