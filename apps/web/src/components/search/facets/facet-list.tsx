import { Input } from "@scholar-seek/ui/components/input";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useState } from "react";
import type { FacetItem as FacetItemType } from "../../../types/paper";
import { FacetItem } from "./facet-item";

const DEFAULT_VISIBLE = 5;

interface FacetListProps {
	formatValue?: (value: string) => string;
	items: FacetItemType[];
	onToggle: (value: string) => void;
	searchable?: boolean;
	selectedValues: string[];
	title: string;
}

export function FacetList({
	title,
	items,
	selectedValues,
	onToggle,
	searchable = false,
	formatValue,
}: FacetListProps) {
	const [expanded, setExpanded] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");

	if (items.length === 0) {
		return null;
	}

	const filteredItems =
		searchable && searchTerm
			? items.filter((item) =>
					item.value.toLowerCase().includes(searchTerm.toLowerCase())
				)
			: items;

	const visible = expanded
		? filteredItems
		: filteredItems.slice(0, DEFAULT_VISIBLE);
	const hasMore = filteredItems.length > DEFAULT_VISIBLE;

	return (
		<div className="space-y-1">
			<p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{title}
			</p>

			{searchable && (
				<div className="relative mb-2">
					<Search className="absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
					<Input
						className="h-7 pl-6 text-xs"
						onChange={(e) => setSearchTerm(e.target.value)}
						placeholder="Search..."
						value={searchTerm}
					/>
				</div>
			)}

			{filteredItems.length === 0 && searchTerm ? (
				<p className="py-1 text-muted-foreground text-xs">No matches found</p>
			) : (
				<>
					<div className="space-y-0.5">
						{visible.map((item) => (
							<FacetItem
								checked={selectedValues.includes(item.value)}
								count={item.count}
								key={item.value}
								label={formatValue?.(item.value)}
								onToggle={onToggle}
								value={item.value}
							/>
						))}
					</div>
					{hasMore && (
						<button
							className="mt-1 flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
							onClick={() => setExpanded((prev) => !prev)}
							type="button"
						>
							{expanded ? (
								<>
									<ChevronUp className="h-3 w-3" />
									Show less
								</>
							) : (
								<>
									<ChevronDown className="h-3 w-3" />
									Show {filteredItems.length - DEFAULT_VISIBLE} more
								</>
							)}
						</button>
					)}
				</>
			)}
		</div>
	);
}
