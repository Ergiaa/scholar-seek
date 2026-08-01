import { Badge } from "@scholar-seek/ui/components/badge";
import { Button } from "@scholar-seek/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@scholar-seek/ui/components/card";
import { Input } from "@scholar-seek/ui/components/input";
import { Label } from "@scholar-seek/ui/components/label";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "../../lib/auth-client";
import {
	estimateRun,
	type RunEstimate,
	type Schedule,
	type TargetInput,
	useCancelRun,
	useConfirmRun,
	useCreateSchedule,
	useDeleteSchedule,
	useScheduleRun,
	useSchedules,
	useUpdateSchedule,
} from "../../lib/hooks/use-schedules";

export const Route = createFileRoute("/admin/crawler")({
	component: CrawlerAdminPage,
});

const SOURCES = ["arxiv", "semantic_scholar", "doaj"] as const;

function formatDuration(seconds: number): string {
	if (seconds < 60) {
		return `${Math.max(1, Math.round(seconds))}s`;
	}
	return `${Math.round(seconds / 60)} min`;
}

function CrawlerAdminPage() {
	// Session state is only known client-side (cookie-based), so the server
	// render and the client's very first paint must show the same thing —
	// otherwise React flags a hydration mismatch. Gate on mount so the first
	// client render always matches the server's "Loading..." output, then
	// resolve to the real session once mounted.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const { data: session, isPending } = useSession();

	if (!mounted || isPending) {
		return <div className="container mx-auto px-4 py-8">Loading...</div>;
	}

	const role = session?.user?.role;
	if (!session || (role !== "admin" && role !== "root_admin")) {
		return (
			<div className="container mx-auto px-4 py-8">
				<p className="text-muted-foreground text-sm">
					Admin access required.
				</p>
			</div>
		);
	}

	return (
		<div className="container mx-auto flex flex-col gap-6 px-4 py-8">
			<h1 className="font-semibold text-xl">Crawler Schedules</h1>
			<CreateScheduleForm />
			<ScheduleList />
		</div>
	);
}

function emptyTarget(): TargetInput {
	return { label: "", maxRecords: 2000 };
}

function CreateScheduleForm() {
	const createSchedule = useCreateSchedule();
	const [name, setName] = useState("");
	const [source, setSource] =
		useState<(typeof SOURCES)[number]>("semantic_scholar");
	const [cronPattern, setCronPattern] = useState("0 3 * * *");
	const [targets, setTargets] = useState<TargetInput[]>([emptyTarget()]);

	function updateTarget(index: number, patch: Partial<TargetInput>) {
		setTargets((prev) =>
			prev.map((t, i) => (i === index ? { ...t, ...patch } : t))
		);
	}

	function addTarget() {
		setTargets((prev) => [...prev, emptyTarget()]);
	}

	function removeTarget(index: number) {
		setTargets((prev) => prev.filter((_, i) => i !== index));
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		await createSchedule.mutateAsync({
			name,
			source,
			cronPattern,
			targets: targets.map((t) => ({
				label: t.label,
				query: t.query?.trim() ? t.query.trim() : undefined,
				categories: t.categories?.length ? t.categories : undefined,
				maxRecords: t.maxRecords,
			})),
		});
		setName("");
		setCronPattern("0 3 * * *");
		setTargets([emptyTarget()]);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>New schedule</CardTitle>
			</CardHeader>
			<CardContent>
				<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div className="flex flex-col gap-1">
							<Label htmlFor="name">Name</Label>
							<Input
								id="name"
								onChange={(e) => setName(e.target.value)}
								required
								value={name}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label htmlFor="source">Source</Label>
							<select
								className="h-8 border bg-background px-2 text-xs"
								id="source"
								onChange={(e) =>
									setSource(e.target.value as (typeof SOURCES)[number])
								}
								value={source}
							>
								{SOURCES.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
						</div>
						<div className="flex flex-col gap-1">
							<Label htmlFor="cron">Cron pattern</Label>
							<Input
								id="cron"
								onChange={(e) => setCronPattern(e.target.value)}
								placeholder="0 3 * * *"
								required
								value={cronPattern}
							/>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<span className="font-medium text-sm">Targets</span>
							<Button onClick={addTarget} size="sm" type="button" variant="outline">
								Add target
							</Button>
						</div>
						{targets.map((target, i) => (
							<div
								className="grid grid-cols-1 gap-2 border p-2 sm:grid-cols-5"
								key={`target-${i}`}
							>
								<Input
									className="sm:col-span-1"
									onChange={(e) => updateTarget(i, { label: e.target.value })}
									placeholder="Label"
									required
									value={target.label}
								/>
								<Input
									className="sm:col-span-1"
									onChange={(e) => updateTarget(i, { query: e.target.value })}
									placeholder="Query (semantic_scholar only)"
									value={target.query ?? ""}
								/>
								<Input
									className="sm:col-span-1"
									onChange={(e) =>
										updateTarget(i, {
											categories: e.target.value
												.split(",")
												.map((c) => c.trim())
												.filter(Boolean),
										})
									}
									placeholder="Categories (comma separated)"
									value={target.categories?.join(", ") ?? ""}
								/>
								<Input
									className="sm:col-span-1"
									min={1}
									onChange={(e) =>
										updateTarget(i, { maxRecords: Number(e.target.value) })
									}
									type="number"
									value={target.maxRecords}
								/>
								<Button
									className="sm:col-span-1"
									disabled={targets.length === 1}
									onClick={() => removeTarget(i)}
									size="sm"
									type="button"
									variant="destructive"
								>
									Remove
								</Button>
							</div>
						))}
					</div>

					<Button disabled={createSchedule.isPending} type="submit">
						{createSchedule.isPending ? "Creating..." : "Create schedule"}
					</Button>
					{createSchedule.isError && (
						<p className="text-destructive text-xs">
							{createSchedule.error.message}
						</p>
					)}
				</form>
			</CardContent>
		</Card>
	);
}

function ScheduleList() {
	const { data: schedules, isLoading, error } = useSchedules();

	if (isLoading) {
		return <p className="text-muted-foreground text-sm">Loading...</p>;
	}
	if (error) {
		return <p className="text-destructive text-sm">{error.message}</p>;
	}

	return (
		<div className="flex flex-col gap-4">
			{schedules?.map((schedule) => (
				<ScheduleCard key={schedule.id} schedule={schedule} />
			))}
			{schedules?.length === 0 && (
				<p className="text-muted-foreground text-sm">No schedules yet.</p>
			)}
		</div>
	);
}

function ScheduleCard({ schedule }: { schedule: Schedule }) {
	const queryClient = useQueryClient();
	const updateSchedule = useUpdateSchedule();
	const deleteSchedule = useDeleteSchedule();
	const [estimate, setEstimate] = useState<RunEstimate | null>(null);
	const [estimateError, setEstimateError] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState("");
	const [activeRunId, setActiveRunId] = useState<string | null>(null);
	const confirmRun = useConfirmRun();
	const cancelRun = useCancelRun();
	const { data: run } = useScheduleRun(activeRunId);

	// The schedule list's "last run" summary is a snapshot from whenever it
	// was last fetched — refresh it once this run leaves "running" so the
	// badge above doesn't sit stale showing the previous state forever.
	useEffect(() => {
		if (run && run.status !== "running") {
			queryClient.invalidateQueries({ queryKey: ["crawl-schedules"] });
		}
	}, [run, queryClient]);

	async function handleEstimate() {
		setEstimateError(null);
		try {
			setEstimate(await estimateRun(schedule.id));
		} catch (err) {
			setEstimateError(err instanceof Error ? err.message : "Failed");
		}
	}

	async function handleRunNow(override?: boolean) {
		const result = await confirmRun.mutateAsync({
			scheduleId: schedule.id,
			override,
		});
		setActiveRunId(result.id);
		setEstimate(null);
		setConfirmText("");
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle>{schedule.name}</CardTitle>
					<p className="text-muted-foreground text-xs">
						{schedule.source} · {schedule.cronPattern}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant={schedule.enabled ? "default" : "secondary"}>
						{schedule.enabled ? "enabled" : "disabled"}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div>
					<p className="font-medium text-xs">
						Targets ({schedule.targets.length})
					</p>
					<ul className="text-muted-foreground text-xs">
						{schedule.targets.map((t) => (
							<li key={t.id}>
								{t.label} — max {t.maxRecords}
								{t.query ? ` — query: "${t.query}"` : ""}
								{t.categories?.length ? ` — [${t.categories.join(", ")}]` : ""}
							</li>
						))}
					</ul>
				</div>

				{schedule.lastRun && (
					<p className="text-muted-foreground text-xs">
						Last run: {schedule.lastRun.status} at{" "}
						{new Date(schedule.lastRun.startedAt).toLocaleString()}
					</p>
				)}

				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={() =>
							updateSchedule.mutate({
								id: schedule.id,
								enabled: !schedule.enabled,
							})
						}
						size="sm"
						variant="outline"
					>
						{schedule.enabled ? "Disable" : "Enable"}
					</Button>
					<Button
						onClick={() => deleteSchedule.mutate(schedule.id)}
						size="sm"
						variant="destructive"
					>
						Delete
					</Button>
					<Button onClick={handleEstimate} size="sm" variant="outline">
						Run now...
					</Button>
				</div>

				{estimateError && (
					<p className="text-destructive text-xs">{estimateError}</p>
				)}

				{estimate && (
					<div className="flex flex-col gap-2 border p-2 text-xs">
						<p>
							{estimate.targetCount} target(s), ~
							{estimate.totalRequestsEstimate} requests, ~
							{formatDuration(estimate.estimatedSeconds)}
						</p>
						{estimate.sharedPoolWarning && (
							<p className="text-amber-600">
								No S2_API_KEY configured — Semantic Scholar's shared rate
								pool may make this take longer than estimated.
							</p>
						)}
						{estimate.requiresOverride ? (
							<div className="flex flex-col gap-2">
								<p className="text-amber-600">
									This exceeds the safe threshold. Type CONFIRM to proceed.
								</p>
								<Input
									onChange={(e) => setConfirmText(e.target.value)}
									placeholder="CONFIRM"
									value={confirmText}
								/>
								<Button
									disabled={confirmText !== "CONFIRM" || confirmRun.isPending}
									onClick={() => handleRunNow(true)}
									size="sm"
									variant="destructive"
								>
									Run anyway
								</Button>
							</div>
						) : (
							<Button
								disabled={confirmRun.isPending}
								onClick={() => handleRunNow(false)}
								size="sm"
							>
								Confirm run
							</Button>
						)}
					</div>
				)}

				{run && (
					<div className="flex items-center gap-2 border p-2 text-xs">
						<span>
							Run {run.status}: {run.completedCount}/{run.targetCount} targets
							{run.failedCount > 0 && (
								<span className="text-destructive">
									{" "}
									({run.failedCount} failed)
								</span>
							)}
						</span>
						{run.status === "running" && (
							<Button
								onClick={() => cancelRun.mutate(run.id)}
								size="sm"
								variant="destructive"
							>
								Cancel
							</Button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
