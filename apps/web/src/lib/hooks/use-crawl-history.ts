import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api/treaty";
import type { CrawlSource } from "./use-schedules";

export interface CrawlHistoryEntry {
	completedAt: string | null;
	durationMs: number | null;
	errors: string[];
	historyId: string;
	jobId: string;
	options: Record<string, unknown> | null;
	papersFound: number;
	papersInserted: number;
	papersSkipped: number;
	scheduleId: string | null;
	scheduleName: string | null;
	source: string;
	startedAt: string;
	status: "running" | "completed" | "failed" | "waiting" | "unknown";
}

export interface CrawlHistoryParams {
	page: number;
	pageSize: number;
	since?: string;
	source?: CrawlSource;
	status?: "running" | "completed" | "failed";
	until?: string;
}

export interface CrawlHistoryResult {
	history: CrawlHistoryEntry[];
	page: number;
	pageSize: number;
	total: number;
}

export function useCrawlHistory(params: CrawlHistoryParams) {
	return useQuery({
		queryKey: ["crawl-history", params],
		queryFn: async () => {
			const { data, error } = await api.api.crawl.history.get({
				query: {
					source: params.source,
					status: params.status,
					since: params.since,
					until: params.until,
					page: params.page,
					pageSize: params.pageSize,
				},
			});
			if (error) {
				throw new Error("Failed to load crawl history");
			}
			return data as CrawlHistoryResult;
		},
		placeholderData: keepPreviousData,
	});
}
