import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import type { FilterSnapshot } from "../../components/search/active-filters";
import { SearchBar } from "../../components/search/search-bar";
import { SearchResults } from "../../components/search/search-results";
import { saveSearchState } from "../../lib/search-state";
import { normalizeToArray } from "../../lib/utils";
import type { SortBy } from "../../types/paper";

const searchSchema = z.object({
	q: z.string().optional(),
	page: z.coerce.number().optional().default(1),
	pageSize: z.coerce.number().optional().default(20),
	author: z.string().optional(),
	journal: z.union([z.string(), z.array(z.string())]).optional(),
	keyword: z.union([z.string(), z.array(z.string())]).optional(),
	yearFrom: z.coerce.number().optional(),
	yearTo: z.coerce.number().optional(),
	sortBy: z
		.enum(["relevance", "date_desc", "date_asc", "title_asc", "author_asc"])
		.optional(),
});

export const Route = createFileRoute("/search/")({
	component: SearchPage,
	validateSearch: searchSchema,
});

function SearchPage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/search/" });
	const {
		q = "",
		page = 1,
		pageSize = 20,
		author,
		journal,
		keyword,
		yearFrom,
		yearTo,
		sortBy,
	} = search;

	// Save search state for "Back to search" functionality — runs on every
	// URL change so filters are always included in the saved URL.
	useEffect(() => {
		if (typeof window !== "undefined") {
			saveSearchState({
				url: window.location.href,
				q,
				page,
				pageSize,
			});
		}
	}, [q, page, pageSize]);

	const handleSearch = (query: string) => {
		navigate({
			to: "/search",
			search: { ...search, q: query, page: 1 },
		});
	};

	const handlePageChange = (newPage: number) => {
		navigate({
			to: "/search",
			search: { ...search, page: newPage },
		});
	};

	const handlePageSizeChange = (newSize: number) => {
		navigate({
			to: "/search",
			search: { ...search, page: 1, pageSize: newSize },
		});
	};

	const handleFiltersChange = (filters: FilterSnapshot) => {
		navigate({
			to: "/search",
			resetScroll: false,
			search: {
				q,
				pageSize,
				page: 1,
				author: filters.authorFilter || undefined,
				journal: filters.journalFilter.length
					? filters.journalFilter
					: undefined,
				keyword: filters.keywordFilter.length
					? filters.keywordFilter
					: undefined,
				yearFrom: filters.yearFrom,
				yearTo: filters.yearTo,
				sortBy: filters.sortBy === "relevance" ? undefined : filters.sortBy,
			},
		});
	};

	const initialFilters = {
		authorFilter: author,
		journalFilter: normalizeToArray(journal),
		keywordFilter: normalizeToArray(keyword),
		yearFrom,
		yearTo,
		sortBy: sortBy as SortBy | undefined,
	};

	return (
		<div className="container mx-auto px-4 py-8">
			<h1 className="sr-only">
				{q ? `Search results for "${q}"` : "Search papers"}
			</h1>
			<div className="mb-8">
				<div className="relative rounded-lg border bg-background shadow-sm">
					<SearchBar defaultValue={q} onSearch={handleSearch} />
				</div>
			</div>
			<SearchResults
				initialFilters={initialFilters}
				onFiltersChange={handleFiltersChange}
				onPageChange={handlePageChange}
				onPageSizeChange={handlePageSizeChange}
				page={page}
				pageSize={pageSize}
				query={q}
			/>
		</div>
	);
}
