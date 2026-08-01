import { Button } from "@scholar-seek/ui/components/button";
import { Skeleton } from "@scholar-seek/ui/components/skeleton";
import { cn } from "@scholar-seek/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ScheduleWizardDialog } from "../../components/admin/schedule-wizard-dialog";
import { sourceBarClassName } from "../../components/admin/source-badge";
import { StatusChip } from "../../components/admin/status-chip";
import { useStats } from "../../lib/hooks/use-stats";

export const Route = createFileRoute("/admin/")({
	component: OverviewPage,
});

const SOURCE_LABELS: Record<string, string> = {
	arxiv: "arXiv",
	semantic_scholar: "Semantic Scholar",
	doaj: "DOAJ",
};

function sourceLabel(source: string | null): string {
	if (!source) {
		return "Unknown";
	}
	return SOURCE_LABELS[source] ?? source;
}

function formatRelativeTime(dateStr: string): string {
	const seconds = Math.max(
		0,
		Math.round((Date.now() - new Date(dateStr).getTime()) / 1000)
	);
	if (seconds < 60) {
		return "just now";
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)}m ago`;
	}
	if (seconds < 86_400) {
		return `${Math.floor(seconds / 3600)}h ago`;
	}
	return `${Math.floor(seconds / 86_400)}d ago`;
}

function OverviewPage() {
	const { data: stats, isLoading, error } = useStats();

	if (isLoading) {
		return <OverviewSkeleton />;
	}

	if (error) {
		return <p className="text-destructive text-sm">{error.message}</p>;
	}

	if (!stats) {
		return null;
	}

	const isFreshInstall = stats.totalPapers === 0 && stats.activeSchedules === 0;
	const totalBySource = stats.bySource.reduce((sum, row) => sum + row.count, 0);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="font-semibold text-xl">Overview</h1>
				<p className="text-muted-foreground text-sm">
					Catalog health and crawler status at a glance.
				</p>
			</div>

			{stats.attention.length > 0 && (
				<div className="flex flex-col gap-2">
					{stats.attention.map((item) => (
						<div
							className="flex items-center gap-3 border border-destructive/25 bg-destructive/5 p-3"
							key={`${item.scheduleId}-${item.reason}`}
						>
							<span className="size-2 shrink-0 rounded-full bg-destructive" />
							<p className="flex-1 text-sm">
								<strong className="font-semibold">{item.scheduleName}</strong>{" "}
								{item.reason === "failed"
									? `failed ${formatRelativeTime(item.startedAt)}.`
									: `has been running since ${formatRelativeTime(item.startedAt)}, past its estimate.`}
							</p>
							<Link
								className="whitespace-nowrap font-medium text-xs hover:underline"
								to={
									item.reason === "failed"
										? "/admin/history"
										: "/admin/schedules"
								}
							>
								{item.reason === "failed"
									? "View in History →"
									: "View schedule →"}
							</Link>
						</div>
					))}
				</div>
			)}

			{isFreshInstall ? (
				<div className="flex flex-col items-center gap-3 border border-dashed p-14 text-center">
					<p className="font-medium text-sm">No data yet</p>
					<p className="text-muted-foreground text-xs">
						The catalog is empty. Create a schedule to start crawling.
					</p>
					<ScheduleWizardDialog
						mode="create"
						trigger={<Button size="sm">Create your first schedule</Button>}
					/>
				</div>
			) : (
				<>
					<div className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-3 lg:grid-cols-6">
						<StatTile
							label="Total papers"
							value={stats.totalPapers.toLocaleString()}
						/>
						<StatTile
							label="Added 24h"
							value={`+${stats.papersAdded24h.toLocaleString()}`}
						/>
						<StatTile
							label="Added 7d"
							value={`+${stats.papersAdded7d.toLocaleString()}`}
						/>
						<StatTile
							label="Embedding coverage"
							value={`${Math.round(stats.embeddingCoveragePercent)}%`}
						/>
						<StatTile
							label="Active schedules"
							value={stats.activeSchedules.toLocaleString()}
						/>
						<StatTile
							label="Running now"
							value={stats.runningNow.toLocaleString()}
							valueClassName={
								stats.runningNow > 0 ? "text-amber-600" : undefined
							}
						/>
					</div>

					<div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
						<div>
							<h3 className="mb-3 border-b pb-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
								By source
							</h3>
							<div className="mb-4 flex h-2 gap-px overflow-hidden bg-muted">
								{stats.bySource.map((row) => {
									const pct =
										totalBySource > 0 ? (row.count / totalBySource) * 100 : 0;
									return (
										<div
											className={sourceBarClassName(row.source)}
											key={row.source ?? "unknown"}
											style={{ width: `${pct}%` }}
										/>
									);
								})}
							</div>
							<div className="flex flex-col gap-2">
								{stats.bySource.map((row) => {
									const pct =
										totalBySource > 0
											? Math.round((row.count / totalBySource) * 100)
											: 0;
									return (
										<div
											className="flex items-center gap-2 text-xs"
											key={row.source ?? "unknown"}
										>
											<span
												className={cn(
													"size-2 shrink-0 rounded-full",
													sourceBarClassName(row.source)
												)}
											/>
											<span className="flex-1 truncate">
												{sourceLabel(row.source)}
											</span>
											<span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums">
												{row.count.toLocaleString()}
											</span>
											<span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">
												{pct}%
											</span>
										</div>
									);
								})}
							</div>
						</div>

						<div>
							<div className="mb-3 flex items-baseline justify-between border-b pb-2">
								<h3 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
									Recent activity
								</h3>
								<Link
									className="font-medium text-xs hover:underline"
									to="/admin/history"
								>
									View all in History →
								</Link>
							</div>
							{stats.recentActivity.length === 0 ? (
								<p className="text-muted-foreground text-xs">No runs yet.</p>
							) : (
								<div className="flex flex-col">
									{stats.recentActivity.map((run) => (
										<div
											className="flex flex-wrap items-center gap-2 border-b py-2 text-xs last:border-b-0"
											key={run.historyId}
										>
											<StatusChip status={run.status} />
											<span className="w-24 shrink-0 truncate font-medium">
												{sourceLabel(run.source)}
											</span>
											<span className="min-w-[90px] flex-1 truncate text-muted-foreground">
												{run.scheduleName ?? "-"}
											</span>
											<span className="w-20 shrink-0 text-center text-muted-foreground tabular-nums">
												{run.papersFound} found
											</span>
											<span className="w-16 shrink-0 text-center text-muted-foreground tabular-nums">
												{run.papersInserted} new
											</span>
											<span className="w-16 shrink-0 text-center text-muted-foreground">
												{formatRelativeTime(run.startedAt)}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</>
			)}
		</div>
	);
}

function StatTile({
	label,
	value,
	valueClassName,
}: {
	label: string;
	value: string;
	valueClassName?: string;
}) {
	return (
		<div className="bg-background p-4">
			<p className="mb-2 font-medium text-[10.5px] text-muted-foreground uppercase tracking-wide">
				{label}
			</p>
			<p className={`font-bold text-xl tabular-nums ${valueClassName ?? ""}`}>
				{value}
			</p>
		</div>
	);
}

function OverviewSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-3 lg:grid-cols-6">
				{Array.from({ length: 6 }).map((_, i) => (
					<div
						className="flex flex-col gap-2 bg-background p-4"
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton grid
						key={i}
					>
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-6 w-12" />
					</div>
				))}
			</div>
			<Skeleton className="h-40 w-full" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}
