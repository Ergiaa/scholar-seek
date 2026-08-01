import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/treaty";

export type CrawlSource = "arxiv" | "semantic_scholar" | "doaj";

export interface ScheduleTarget {
	categories: string[] | null;
	id: string;
	label: string;
	maxRecords: number;
	query: string | null;
	source: string;
}

export interface Schedule {
	createdAt: string;
	createdBy: string | null;
	cronPattern: string;
	enabled: boolean;
	id: string;
	lastRun: {
		id: string;
		status: string;
		startedAt: string;
		completedAt: string | null;
	} | null;
	name: string;
	targets: ScheduleTarget[];
	updatedAt: string;
}

export interface RunEstimate {
	estimatedSeconds: number;
	requiresOverride: boolean;
	scheduleId: string;
	sharedPoolWarning: boolean;
	targetCount: number;
	totalRequestsEstimate: number;
}

export interface ScheduleRun {
	cancelledAt: string | null;
	completedAt: string | null;
	completedCount: number;
	failedCount: number;
	id: string;
	scheduleId: string;
	startedAt: string;
	status: string;
	targetCount: number;
	totalRequestsEstimate: number;
}

// The local form model allows `source` to be unset while an admin is still
// picking one for a newly added row; the backend requires it on submit.
export interface TargetInput {
	categories?: string[];
	label: string;
	maxRecords: number;
	query?: string;
	source?: CrawlSource;
}

export interface TargetSubmitInput {
	categories?: string[];
	label: string;
	maxRecords: number;
	query?: string;
	source: CrawlSource;
}

export interface CreateScheduleInput {
	cronPattern: string;
	name: string;
	targets: TargetSubmitInput[];
}

export interface UpdateScheduleInput {
	cronPattern?: string;
	enabled?: boolean;
	name?: string;
	targets?: TargetSubmitInput[];
}

function isErrorWithMessage(value: unknown): value is { error: string } {
	return typeof value === "object" && value !== null && "error" in value;
}

export function useSchedules() {
	return useQuery({
		queryKey: ["crawl-schedules"],
		queryFn: async () => {
			const { data, error } = await api.api.crawl.schedules.get();
			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to load schedules";
				throw new Error(message);
			}
			return data as Schedule[];
		},
	});
}

export function useCreateSchedule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: CreateScheduleInput) => {
			const { data, error } = await api.api.crawl.schedules.post(input);
			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to create schedule";
				throw new Error(message);
			}
			return data as Schedule;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["crawl-schedules"] });
		},
	});
}

export function useUpdateSchedule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({
			id,
			...input
		}: UpdateScheduleInput & { id: string }) => {
			const { data, error } = await api.api.crawl
				.schedules({ id })
				.patch(input);
			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to update schedule";
				throw new Error(message);
			}
			return data as Schedule;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["crawl-schedules"] });
		},
	});
}

export function useDeleteSchedule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const { error } = await api.api.crawl.schedules({ id }).delete();
			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to delete schedule";
				throw new Error(message);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["crawl-schedules"] });
		},
	});
}

export async function estimateRun(scheduleId: string): Promise<RunEstimate> {
	const { data, error } = await api.api.crawl
		.schedules({ id: scheduleId })
		.run.get();
	if (error) {
		const message = isErrorWithMessage(error.value)
			? error.value.error
			: "Failed to estimate run";
		throw new Error(message);
	}
	return data as RunEstimate;
}

export function useConfirmRun() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({
			scheduleId,
			override,
		}: {
			scheduleId: string;
			override?: boolean;
		}) => {
			const { data, error } = await api.api.crawl
				.schedules({ id: scheduleId })
				.run.post({
					override,
				});
			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to start run";
				throw new Error(message);
			}
			return data as ScheduleRun;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["crawl-schedules"] });
		},
	});
}

export function useScheduleRun(runId: string | null) {
	return useQuery({
		queryKey: ["crawl-schedule-run", runId],
		queryFn: async () => {
			const { data, error } = await api.api.crawl.schedules
				.runs({
					runId: runId as string,
				})
				.get();
			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to load run status";
				throw new Error(message);
			}
			return data as ScheduleRun;
		},
		enabled: !!runId,
		refetchInterval: (query) =>
			query.state.data?.status === "running" ? 2000 : false,
	});
}

export function useCancelRun() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (runId: string) => {
			const { data, error } = await api.api.crawl.schedules
				.runs({
					runId,
				})
				.cancel.post();
			if (error) {
				const message = isErrorWithMessage(error.value)
					? error.value.error
					: "Failed to cancel run";
				throw new Error(message);
			}
			return data as ScheduleRun;
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ["crawl-schedules"] });
			queryClient.invalidateQueries({
				queryKey: ["crawl-schedule-run", data.id],
			});
		},
	});
}
