import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SearchParams } from "../../types/paper";
import { api } from "../api/treaty";

function isErrorWithMessage(value: unknown): value is { error: string } {
	return typeof value === "object" && value !== null && "error" in value;
}

export function useSearchPapers(params: SearchParams) {
	return useQuery({
		queryKey: ["papers", "search", params],
		queryFn: async () => {
			const { data, error } = await api.api.papers.get({
				query: {
					q: params.q,
					searchIn: params.searchIn,
					searchMode: params.searchMode,
					field: params.field,
					page: params.page,
					pageSize: params.pageSize,
					sortBy: params.sortBy,
					author: params.authorFilter,
					journal: params.journalFilter,
					keyword: params.keywordFilter,
					source: params.sourceFilter,
					yearFrom: params.yearFrom,
					yearTo: params.yearTo,
				},
			});

			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to search papers";
				throw new Error(message);
			}

			return {
				papers: data.papers.map((p) => ({
					...p,
					publishedAt: p.publishedAt ?? "",
				})),
				total: data.total,
				page: data.page,
				pageSize: data.pageSize,
				facets: data.facets,
				subqueries: data.subqueries,
			};
		},
		enabled: !!params.q,
		placeholderData: keepPreviousData,
	});
}

export function usePaper(id: string) {
	return useQuery({
		queryKey: ["paper", id],
		queryFn: async () => {
			const { data, error } = await api.api.papers({ id }).get();

			if (error) {
				if (error.status === 404) {
					return null;
				}
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to get paper";
				throw new Error(message);
			}

			return {
				...data,
				publishedAt: data.publishedAt ?? "",
			};
		},
		enabled: !!id,
	});
}

export function useRelatedPapers(id: string, limit = 5) {
	return useQuery({
		queryKey: ["papers", "related", id, limit],
		queryFn: async () => {
			const { data, error } = await api.api.papers({ id }).related.get({
				query: { limit },
			});

			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to get related papers";
				throw new Error(message);
			}

			return data.map((p) => ({
				...p,
				publishedAt: p.publishedAt ?? "",
			}));
		},
		enabled: !!id,
	});
}

export function useAvailableJournals() {
	return useQuery({
		queryKey: ["journals", "available"],
		queryFn: async () => {
			const { data, error } = await api.api.journals.get();

			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to get journals";
				throw new Error(message);
			}

			return data;
		},
	});
}
