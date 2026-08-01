import { Badge } from "@scholar-seek/ui/components/badge";
import { cn } from "@scholar-seek/ui/lib/utils";

export type StatusChipStatus =
	| "enabled"
	| "disabled"
	| "active"
	| "banned"
	| "running"
	| "completed"
	| "failed"
	| "waiting"
	| "unknown"
	| "cancelled"
	| "never_run";

type BadgeVariant =
	| "default"
	| "secondary"
	| "destructive"
	| "success"
	| "warning"
	| "outline"
	| "ghost"
	| "link"
	| "keyword";

const STATUS_CONFIG: Record<
	StatusChipStatus,
	{ label: string; variant: BadgeVariant; dotClassName?: string }
> = {
	enabled: { label: "Enabled", variant: "success" },
	disabled: { label: "Disabled", variant: "secondary" },
	active: { label: "Active", variant: "success" },
	banned: { label: "Banned", variant: "destructive" },
	completed: { label: "Completed", variant: "success" },
	failed: { label: "Failed", variant: "destructive" },
	running: {
		label: "Running",
		variant: "warning",
		dotClassName: "animate-pulse bg-amber-500",
	},
	waiting: { label: "Waiting", variant: "secondary" },
	unknown: { label: "Unknown", variant: "secondary" },
	cancelled: { label: "Cancelled", variant: "secondary" },
	never_run: { label: "Never run", variant: "outline" },
};

function StatusChip({
	status,
	className,
}: {
	status: string;
	className?: string;
}) {
	const config =
		STATUS_CONFIG[status as StatusChipStatus] ??
		({ label: status, variant: "secondary" } as const);

	return (
		<Badge
			className={cn("w-24 shrink-0 justify-center gap-1.5", className)}
			variant={config.variant}
		>
			{config.dotClassName && (
				<span className={cn("size-1.5 rounded-full", config.dotClassName)} />
			)}
			{config.label}
		</Badge>
	);
}

export { StatusChip };
