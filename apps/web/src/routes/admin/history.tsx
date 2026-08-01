import { Button } from "@scholar-seek/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { StatusChip } from "../../components/admin/status-chip";
import {
	type CrawlHistoryEntry,
	useCrawlHistory,
} from "../../lib/hooks/use-crawl-history";
import type { CrawlSource } from "../../lib/hooks/use-schedules";

export const Route = createFileRoute("/admin/history")({
	component: HistoryPage,
});

const PAGE_SIZE = 20;

const SOURCE_OPTIONS: { value: CrawlSource | ""; label: string }[] = [
	{ value: "", label: "All sources" },
	{ value: "arxiv", label: "arXiv" },
	{ value: "semantic_scholar", label: "Semantic Scholar" },
	{ value: "doaj", label: "DOAJ" },
];

const STATUS_OPTIONS: {
	value: "" | "running" | "completed" | "failed";
	label: string;
}[] = [
	{ value: "", label: "All statuses" },
	{ value: "running", label: "Running" },
	{ value: "completed", label: "Completed" },
	{ value: "failed", label: "Failed" },
];

const PAGE_WINDOW = 5;

function getPageNumbers(current: number, total: number): number[] {
	const half = Math.floor(PAGE_WINDOW / 2);
	let start = Math.max(1, current - half);
	const end = Math.min(total, start + PAGE_WINDOW - 1);
	start = Math.max(1, end - PAGE_WINDOW + 1);
	return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function formatDuration(ms: number | null): string {
	if (ms == null) {
		return "-";
	}
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function HistoryPage() {
	const [source, setSource] = useState<CrawlSource | "">("");
	const [status, setStatus] = useState<"" | "running" | "completed" | "failed">(
		""
	);
	const [since, setSince] = useState("");
	const [until, setUntil] = useState("");
	const [page, setPage] = useState(1);
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const { data, isLoading, error } = useCrawlHistory({
		source: source || undefined,
		status: status || undefined,
		since: since || undefined,
		until: until || undefined,
		page,
		pageSize: PAGE_SIZE,
	});

	function updateFilter<T>(setter: (v: T) => void, value: T) {
		setter(value);
		setPage(1);
	}

	const total = data?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
	const rangeEnd = Math.min(page * PAGE_SIZE, total);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="font-semibold text-xl">Crawl History</h1>
				<p className="text-muted-foreground text-sm">
					Every run, across every schedule, for debugging what happened and why.
				</p>
			</div>

			<div className="flex flex-wrap gap-2">
				<select
					className="h-8 border bg-background px-2 text-xs"
					onChange={(e) =>
						updateFilter(setSource, e.target.value as CrawlSource | "")
					}
					value={source}
				>
					{SOURCE_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
				<select
					className="h-8 border bg-background px-2 text-xs"
					onChange={(e) =>
						updateFilter(
							setStatus,
							e.target.value as "" | "running" | "completed" | "failed"
						)
					}
					value={status}
				>
					{STATUS_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
				<input
					className="h-8 border bg-background px-2 text-xs"
					onChange={(e) => updateFilter(setSince, e.target.value)}
					type="date"
					value={since}
				/>
				<input
					className="h-8 border bg-background px-2 text-xs"
					onChange={(e) => updateFilter(setUntil, e.target.value)}
					type="date"
					value={until}
				/>
			</div>

			{isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
			{error && <p className="text-destructive text-sm">{error.message}</p>}

			{data && data.history.length === 0 && (
				<div className="flex flex-col items-center gap-3 border border-dashed p-10 text-center">
					<p className="font-medium text-sm">No runs found</p>
					<p className="text-muted-foreground text-xs">
						Try widening the filters above, or check back after a schedule runs.
					</p>
					{(source || status || since || until) && (
						<Button
							onClick={() => {
								updateFilter(setSource, "");
								updateFilter(setStatus, "");
								updateFilter(setSince, "");
								updateFilter(setUntil, "");
							}}
							size="sm"
							variant="outline"
						>
							Clear filters
						</Button>
					)}
				</div>
			)}

			{data && data.history.length > 0 && (
				<>
					<div className="border">
						<div className="flex items-center gap-2.5 border-b bg-muted/50 px-4 py-2 font-medium text-[10.5px] text-muted-foreground uppercase tracking-wide">
							<span className="w-32 shrink-0">Started</span>
							<span className="w-28 shrink-0">Source</span>
							<span className="w-24 shrink-0">Status</span>
							<span className="min-w-[100px] flex-1">
								Found / inserted / skipped
							</span>
							<span className="w-16 shrink-0">Duration</span>
							<span className="min-w-[120px] flex-1">Schedule</span>
						</div>
						{data.history.map((entry) => (
							<HistoryRow
								entry={entry}
								expanded={expandedId === entry.historyId}
								key={entry.historyId}
								onToggle={() =>
									setExpandedId((prev) =>
										prev === entry.historyId ? null : entry.historyId
									)
								}
							/>
						))}
					</div>

					<div className="flex items-center justify-between text-muted-foreground text-xs">
						<span>
							Showing {rangeStart}–{rangeEnd} of {total} runs
						</span>
						<div className="flex gap-1">
							<Button
								disabled={page <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
								size="sm"
								variant="outline"
							>
								← Prev
							</Button>
							{getPageNumbers(page, totalPages).map((p) => (
								<Button
									key={p}
									onClick={() => setPage(p)}
									size="sm"
									variant={p === page ? "default" : "outline"}
								>
									{p}
								</Button>
							))}
							<Button
								disabled={page >= totalPages}
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								size="sm"
								variant="outline"
							>
								Next →
							</Button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

function HistoryRow({
	entry,
	expanded,
	onToggle,
}: {
	entry: CrawlHistoryEntry;
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<div>
			<button
				className={`flex w-full items-center gap-2.5 border-b px-4 py-2.5 text-left text-xs hover:bg-muted/30 ${entry.status === "running" ? "bg-amber-500/5" : ""}`}
				onClick={onToggle}
				type="button"
			>
				<span className="w-32 shrink-0 tabular-nums">
					{new Date(entry.startedAt).toLocaleString()}
				</span>
				<span className="w-28 shrink-0">{entry.source}</span>
				<span className="w-24 shrink-0">
					<StatusChip status={entry.status} />
				</span>
				<span className="min-w-[100px] flex-1 text-muted-foreground tabular-nums">
					{entry.papersFound} / {entry.papersInserted} / {entry.papersSkipped}
				</span>
				<span className="w-16 shrink-0 text-muted-foreground tabular-nums">
					{formatDuration(entry.durationMs)}
				</span>
				<span className="min-w-[120px] flex-1 truncate">
					{entry.scheduleName ?? "-"}
				</span>
			</button>
			{expanded && (
				<div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 text-xs">
					{entry.errors.length > 0 && (
						<div>
							<p className="mb-1 font-medium text-destructive">
								Errors ({entry.errors.length})
							</p>
							<ul className="flex flex-col gap-1 font-mono text-[11.5px] text-muted-foreground">
								{entry.errors.map((err) => (
									<ErrorLine key={err} text={err} />
								))}
							</ul>
						</div>
					)}
					{entry.options && Object.keys(entry.options).length > 0 && (
						<div>
							<p className="mb-1 font-medium text-muted-foreground">
								Options used
							</p>
							<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-3">
								{Object.entries(entry.options).map(([key, value]) => (
									<span key={key}>
										{key}: {JSON.stringify(value)}
									</span>
								))}
							</div>
						</div>
					)}
					{entry.scheduleId && (
						<Link
							className="w-fit font-medium text-primary text-xs hover:underline"
							to="/admin/schedules"
						>
							Back to schedule →
						</Link>
					)}
				</div>
			)}
		</div>
	);
}

const ERROR_TRUNCATE_LENGTH = 300;

function ErrorLine({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const isLong = text.length > ERROR_TRUNCATE_LENGTH;
	const shown =
		expanded || !isLong ? text : `${text.slice(0, ERROR_TRUNCATE_LENGTH)}…`;

	return (
		<li className="break-words">
			{shown}
			{isLong && (
				<button
					className="ml-1 font-medium font-sans text-primary text-xs hover:underline"
					onClick={() => setExpanded((e) => !e)}
					type="button"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</li>
	);
}
