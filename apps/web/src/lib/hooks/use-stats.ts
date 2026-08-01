import { useQuery } from "@tanstack/react-query";
import { api } from "../api/treaty";
import type { CrawlHistoryEntry } from "./use-crawl-history";

export interface StatsAttentionItem {
	reason: "failed" | "running_past_estimate";
	scheduleId: string;
	scheduleName: string;
	startedAt: string;
	status: string;
}

export interface Stats {
	activeSchedules: number;
	attention: StatsAttentionItem[];
	bySource: { source: string | null; count: number }[];
	embeddingCoveragePercent: number;
	papersAdded7d: number;
	papersAdded24h: number;
	recentActivity: CrawlHistoryEntry[];
	runningNow: number;
	totalPapers: number;
}

export function useStats() {
	return useQuery({
		queryKey: ["crawl-stats"],
		queryFn: async () => {
			const { data, error } = await api.api.crawl.stats.get();
			if (error) {
				throw new Error("Failed to load stats");
			}
			return data as Stats;
		},
	});
}
