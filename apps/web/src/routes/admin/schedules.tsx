import { Button } from "@scholar-seek/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@scholar-seek/ui/components/dialog";
import { Input } from "@scholar-seek/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	describeCron,
	distinctSources,
	ScheduleWizardDialog,
} from "../../components/admin/schedule-wizard-dialog";
import { SourceBadge } from "../../components/admin/source-badge";
import { StatusChip } from "../../components/admin/status-chip";
import { useSession } from "../../lib/auth-client";
import {
	estimateRun,
	type RunEstimate,
	type Schedule,
	useCancelRun,
	useConfirmRun,
	useScheduleRun,
	useSchedules,
	useUpdateSchedule,
} from "../../lib/hooks/use-schedules";

export const Route = createFileRoute("/admin/schedules")({
	component: SchedulesPage,
});

function formatDuration(seconds: number): string {
	if (seconds < 60) {
		return `${Math.max(1, Math.round(seconds))}s`;
	}
	return `${Math.round(seconds / 60)} min`;
}

function SchedulesPage() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-xl">Schedules</h1>
					<p className="text-muted-foreground text-sm">
						Define crawl targets, trigger runs, watch progress.
					</p>
				</div>
				<ScheduleWizardDialog
					mode="create"
					trigger={<Button>+ New schedule</Button>}
				/>
			</div>
			<ScheduleList />
		</div>
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

	if (schedules?.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 border border-dashed p-10 text-center">
				<p className="font-medium text-sm">No schedules yet</p>
				<p className="text-muted-foreground text-xs">
					Create your first crawl schedule to start populating the catalog.
				</p>
				<ScheduleWizardDialog
					mode="create"
					trigger={<Button size="sm">Create a schedule</Button>}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col border">
			{schedules?.map((schedule) => (
				<ScheduleRow key={schedule.id} schedule={schedule} />
			))}
		</div>
	);
}

function ScheduleRow({ schedule }: { schedule: Schedule }) {
	const updateSchedule = useUpdateSchedule();

	async function toggleEnabled() {
		try {
			await updateSchedule.mutateAsync({
				id: schedule.id,
				enabled: !schedule.enabled,
			});
			toast.success(
				schedule.enabled ? "Schedule disabled" : "Schedule enabled"
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Update failed");
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-3 border-b p-4 last:border-b-0">
			<span
				className={`size-2.5 shrink-0 rounded-full ${schedule.enabled ? "bg-primary" : "bg-muted-foreground/30"}`}
			/>
			<div className="w-56 shrink-0">
				<p className="truncate font-medium text-sm">{schedule.name}</p>
				<p className="truncate text-muted-foreground text-xs">
					{describeCron(schedule.cronPattern)}
				</p>
				<p className="truncate font-mono text-muted-foreground text-xs">
					{schedule.cronPattern}
				</p>
			</div>
			<div className="flex w-56 shrink-0 flex-wrap gap-1">
				{distinctSources(schedule).map((source) => (
					<SourceBadge key={source} source={source} />
				))}
			</div>
			<span className="w-16 shrink-0 whitespace-nowrap text-muted-foreground text-xs">
				{schedule.targets.length} target
				{schedule.targets.length === 1 ? "" : "s"}
			</span>
			<div className="w-64 shrink-0">
				{schedule.lastRun ? (
					<div className="flex items-center gap-1.5">
						<StatusChip status={schedule.lastRun.status} />
						<span className="truncate whitespace-nowrap text-muted-foreground text-xs">
							{new Date(schedule.lastRun.startedAt).toLocaleString()}
						</span>
					</div>
				) : (
					<StatusChip status="never_run" />
				)}
			</div>
			<div className="ml-auto flex shrink-0 gap-2">
				<ScheduleWizardDialog
					mode="edit"
					schedule={schedule}
					trigger={
						<Button size="sm" variant="outline">
							Edit
						</Button>
					}
				/>
				<Button
					className="w-20"
					disabled={updateSchedule.isPending}
					onClick={toggleEnabled}
					size="sm"
					variant="outline"
				>
					{schedule.enabled ? "Disable" : "Enable"}
				</Button>
				<RunNowDialog schedule={schedule} />
			</div>
		</div>
	);
}

// --- Run-now flow ---

function RunNowDialog({ schedule }: { schedule: Schedule }) {
	const { data: session } = useSession();
	const isRootAdmin = session?.user?.role === "root_admin";
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [estimate, setEstimate] = useState<RunEstimate | null>(null);
	const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null);
	const [estimateError, setEstimateError] = useState<string | null>(null);
	const [confirmText, setConfirmText] = useState("");
	const [activeRunId, setActiveRunId] = useState<string | null>(null);
	const confirmRun = useConfirmRun();
	const cancelRun = useCancelRun();
	const { data: run } = useScheduleRun(activeRunId);

	// The schedule list's "last run" summary is a snapshot from whenever it
	// was last fetched; refresh it once this run leaves "running" so the
	// row above doesn't sit stale showing the previous state forever.
	useEffect(() => {
		if (run && run.status !== "running") {
			queryClient.invalidateQueries({ queryKey: ["crawl-schedules"] });
		}
	}, [run, queryClient]);

	async function handleOpenChange(next: boolean) {
		setOpen(next);
		if (next && !estimate && !run) {
			setEstimateError(null);
			try {
				const result = await estimateRun(schedule.id);
				setEstimate(result);
				setEstimatedSeconds(result.estimatedSeconds);
			} catch (err) {
				setEstimateError(err instanceof Error ? err.message : "Failed");
			}
		}
		if (!next) {
			setEstimate(null);
			setEstimatedSeconds(null);
			setEstimateError(null);
			setConfirmText("");
			setActiveRunId(null);
		}
	}

	async function handleRunNow(override?: boolean) {
		try {
			const result = await confirmRun.mutateAsync({
				scheduleId: schedule.id,
				override,
			});
			setActiveRunId(result.id);
			setEstimate(null);
			setConfirmText("");
			toast.success("Run started");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to start run");
		}
	}

	async function handleCancel() {
		if (!run) {
			return;
		}
		try {
			await cancelRun.mutateAsync(run.id);
			toast.success("Run cancelled");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to cancel run");
		}
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogTrigger render={<Button size="sm">Run now</Button>} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Run "{schedule.name}" now</DialogTitle>
				</DialogHeader>

				{estimateError && (
					<p className="text-destructive text-sm">{estimateError}</p>
				)}

				{estimate && !run && (
					<div className="flex flex-col gap-3 text-sm">
						<p>
							{estimate.targetCount} target(s), ~
							{estimate.totalRequestsEstimate} requests, ~
							{formatDuration(estimate.estimatedSeconds)} estimated.
						</p>
						{estimate.sharedPoolWarning && (
							<p className="border bg-amber-500/10 p-2 text-amber-600 text-xs">
								No S2_API_KEY configured: Semantic Scholar's shared rate pool
								may make this take longer than estimated.
							</p>
						)}
						{estimate.requiresOverride && isRootAdmin && (
							<>
								<p className="border bg-primary/10 p-2 font-medium text-primary text-xs">
									Root admin: override not required.
								</p>
								<Button
									disabled={confirmRun.isPending}
									onClick={() => handleRunNow(true)}
									variant="destructive"
								>
									Run anyway
								</Button>
							</>
						)}
						{estimate.requiresOverride && !isRootAdmin && (
							<div className="flex flex-col gap-2">
								<p className="font-medium text-destructive text-xs">
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
									variant="destructive"
								>
									Run anyway
								</Button>
							</div>
						)}
						{!estimate.requiresOverride && (
							<Button
								disabled={confirmRun.isPending}
								onClick={() => handleRunNow(false)}
							>
								Confirm run
							</Button>
						)}
					</div>
				)}

				{run && (
					<div className="flex flex-col gap-3 text-sm">
						<div className="h-1.5 overflow-hidden bg-muted">
							<div
								className="h-full bg-primary transition-all"
								style={{
									width: `${run.targetCount ? Math.round((run.completedCount / run.targetCount) * 100) : 0}%`,
								}}
							/>
						</div>
						<div className="flex justify-between">
							<span>
								{run.completedCount} / {run.targetCount} completed
							</span>
							{run.failedCount > 0 && (
								<span className="font-medium text-destructive">
									{run.failedCount} failed
								</span>
							)}
						</div>
						{run.status === "running" && (
							<div className="flex flex-col gap-0.5 text-muted-foreground text-xs">
								<span>
									Elapsed{" "}
									{formatDuration(
										Math.max(
											0,
											Math.round(
												(Date.now() - new Date(run.startedAt).getTime()) / 1000
											)
										)
									)}
								</span>
								{estimatedSeconds != null && (
									<span>Estimated {formatDuration(estimatedSeconds)}</span>
								)}
							</div>
						)}
						<StatusChip status={run.status} />
						{run.status === "running" && (
							<Button
								disabled={cancelRun.isPending}
								onClick={handleCancel}
								variant="destructive"
							>
								Cancel remaining
							</Button>
						)}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
