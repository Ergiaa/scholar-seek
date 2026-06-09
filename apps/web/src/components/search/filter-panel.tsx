import { Button } from "@scholar-seek/ui/components/button";
import { Separator } from "@scholar-seek/ui/components/separator";
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { Facets } from "../../types/paper";
import { useFilterContext } from "./active-filters";
import { FacetList } from "./facets/facet-list";
import { AuthorFilter } from "./filters/author-filter";
import { DateRangeFilter } from "./filters/date-range-filter";

interface FilterPanelProps {
	facets?: Facets;
}

function FilterContent({ facets }: FilterPanelProps) {
	const {
		authorFilter,
		journalFilter,
		keywordFilter,
		yearFrom,
		yearTo,
		activeFilterCount,
		setAuthorFilter,
		setJournalFilter,
		setKeywordFilter,
		setYearRange,
		clearAllFilters,
		YEAR_MIN,
		YEAR_MAX,
	} = useFilterContext();

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<span className="font-bold text-base">Filters</span>
				{activeFilterCount > 0 && (
					<button
						className="flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
						onClick={clearAllFilters}
						type="button"
					>
						<X className="h-3 w-3" />
						Clear all ({activeFilterCount})
					</button>
				)}
			</div>

			<Separator />

			<div className="space-y-2">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Publication Year
				</p>
				<DateRangeFilter
					onYearRangeChange={setYearRange}
					yearFrom={yearFrom}
					yearMax={YEAR_MAX}
					yearMin={YEAR_MIN}
					yearTo={yearTo}
				/>
			</div>

			<Separator />

			<div className="space-y-2">
				<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Author
				</p>
				<AuthorFilter onChange={setAuthorFilter} value={authorFilter} />
			</div>

			<Separator />

			{facets && facets.journals.length > 0 ? (
				<FacetList
					items={facets.journals}
					onToggle={(value) => {
						if (journalFilter.includes(value)) {
							setJournalFilter(journalFilter.filter((j) => j !== value));
						} else {
							setJournalFilter([...journalFilter, value]);
						}
					}}
					searchable
					selectedValues={journalFilter}
					title="Journal"
				/>
			) : null}

			{facets && facets.keywords.length > 0 && (
				<>
					<Separator />
					<FacetList
						items={facets.keywords}
						onToggle={(value) => {
							if (keywordFilter.includes(value)) {
								setKeywordFilter(keywordFilter.filter((k) => k !== value));
							} else {
								setKeywordFilter([...keywordFilter, value]);
							}
						}}
						searchable
						selectedValues={keywordFilter}
						title="Keywords"
					/>
				</>
			)}
		</div>
	);
}

export function FilterPanel({ facets }: FilterPanelProps) {
	const [mobileOpen, setMobileOpen] = useState(false);

	return (
		<>
			{/* Mobile toggle */}
			<div className="mb-4 lg:hidden">
				<Button
					className="w-full"
					onClick={() => setMobileOpen((prev) => !prev)}
					type="button"
					variant="outline"
				>
					<SlidersHorizontal className="mr-2 h-4 w-4" />
					Filters
					{mobileOpen ? (
						<ChevronUp className="ml-2 h-4 w-4" />
					) : (
						<ChevronDown className="ml-2 h-4 w-4" />
					)}
				</Button>
			</div>

			<aside
				aria-label="Filters"
				className={`w-full shrink-0 self-start lg:sticky lg:top-4 lg:w-64 ${
					mobileOpen ? "block" : "hidden lg:block"
				}`}
			>
				<div className="relative rounded-xl border border-sidebar-border bg-sidebar text-sidebar-foreground">
					<div className="max-h-[calc(100vh-2rem)] overflow-y-auto p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:w-0">
						<FilterContent facets={facets} />
					</div>
					<div className="pointer-events-none absolute right-0 bottom-0 left-0 h-8 rounded-b-xl bg-gradient-to-t from-sidebar to-transparent" />
				</div>
			</aside>
		</>
	);
}
