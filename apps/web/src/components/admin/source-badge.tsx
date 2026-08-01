import { cn } from "@scholar-seek/ui/lib/utils";

const SOURCE_CONFIG: Record<
	string,
	{ label: string; className: string; barClassName: string }
> = {
	arxiv: {
		label: "arXiv",
		className:
			"bg-indigo-500/10 text-indigo-700 dark:bg-indigo-400/20 dark:text-indigo-300",
		barClassName: "bg-indigo-500 dark:bg-indigo-400",
	},
	semantic_scholar: {
		label: "Semantic Scholar",
		className:
			"bg-blue-500/10 text-blue-700 dark:bg-blue-400/20 dark:text-blue-300",
		barClassName: "bg-blue-500 dark:bg-blue-400",
	},
	doaj: {
		label: "DOAJ",
		className:
			"bg-purple-500/10 text-purple-700 dark:bg-purple-400/20 dark:text-purple-300",
		barClassName: "bg-purple-500 dark:bg-purple-400",
	},
};

const DEFAULT_BAR_CLASSNAME = "bg-muted-foreground";

export function sourceBarClassName(source: string | null): string {
	if (!source) {
		return DEFAULT_BAR_CLASSNAME;
	}
	return SOURCE_CONFIG[source]?.barClassName ?? DEFAULT_BAR_CLASSNAME;
}

function SourceBadge({
	source,
	className,
}: {
	source: string;
	className?: string;
}) {
	const config = SOURCE_CONFIG[source] ?? {
		label: source,
		className: "bg-secondary text-secondary-foreground",
	};

	return (
		<span
			className={cn(
				"inline-flex h-5 w-fit shrink-0 items-center whitespace-nowrap rounded-none px-2 py-0.5 font-medium text-xs",
				config.className,
				className
			)}
		>
			{config.label}
		</span>
	);
}

export { SourceBadge };
