import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { SortBy } from "../../types/paper";

export interface FilterSnapshot {
	authorFilter: string;
	journalFilter: string[];
	keywordFilter: string[];
	sortBy: SortBy;
	yearFrom: number;
	yearTo: number;
}

interface FilterContextValue {
	activeFilterCount: number;
	authorFilter: string;
	clearAllFilters: () => void;
	journalFilter: string[];
	keywordFilter: string[];
	setAuthorFilter: (value: string) => void;
	setJournalFilter: (values: string[]) => void;
	setKeywordFilter: (values: string[]) => void;
	setSortBy: (value: SortBy) => void;
	setYearRange: (from: number, to: number) => void;
	sortBy: SortBy;
	YEAR_MAX: number;
	YEAR_MIN: number;
	yearFrom: number;
	yearTo: number;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function useFilterContext() {
	const context = useContext(FilterContext);
	if (!context) {
		throw new Error("useFilterContext must be used within FilterProvider");
	}
	return context;
}

interface FilterProviderProps {
	children: ReactNode;
	onFiltersChange?: (filters: FilterSnapshot) => void;
	onPageReset?: () => void;
	search: {
		authorFilter?: string;
		journalFilter?: string[];
		keywordFilter?: string[];
		yearFrom?: number;
		yearTo?: number;
		sortBy?: SortBy;
	};
}

const YEAR_MIN = 1990;
const YEAR_MAX = new Date().getFullYear();

export function FilterProvider({
	children,
	search,
	onPageReset,
	onFiltersChange,
}: FilterProviderProps) {
	const [authorFilter, setAuthorFilterState] = useState(
		search.authorFilter ?? ""
	);
	const [journalFilter, setJournalFilterState] = useState(
		search.journalFilter ?? []
	);
	const [keywordFilter, setKeywordFilterState] = useState(
		search.keywordFilter ?? []
	);
	const [yearFrom, setYearFrom] = useState(search.yearFrom ?? YEAR_MIN);
	const [yearTo, setYearTo] = useState(search.yearTo ?? YEAR_MAX);
	const [sortBy, setSortBy] = useState<SortBy>(search.sortBy ?? "relevance");

	// Skip firing on the initial mount — only notify on actual user-driven changes.
	const mounted = useRef(false);
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		}
		onFiltersChange?.({
			authorFilter,
			journalFilter,
			keywordFilter,
			yearFrom,
			yearTo,
			sortBy,
		});
	}, [
		authorFilter,
		journalFilter,
		keywordFilter,
		yearFrom,
		yearTo,
		sortBy,
		onFiltersChange,
	]);

	const activeFilterCount = useMemo(() => {
		let count = 0;
		if (authorFilter) {
			count++;
		}
		if (yearFrom !== YEAR_MIN || yearTo !== YEAR_MAX) {
			count++;
		}
		count += journalFilter.length;
		count += keywordFilter.length;
		return count;
	}, [authorFilter, journalFilter, keywordFilter, yearFrom, yearTo]);

	function setAuthorFilter(value: string) {
		setAuthorFilterState(value);
		onPageReset?.();
	}

	function setJournalFilter(values: string[]) {
		setJournalFilterState(values);
		onPageReset?.();
	}

	function setKeywordFilter(values: string[]) {
		setKeywordFilterState(values);
		onPageReset?.();
	}

	function setYearRange(from: number, to: number) {
		setYearFrom(from);
		setYearTo(to);
		onPageReset?.();
	}

	function clearAllFilters() {
		setAuthorFilterState("");
		setJournalFilterState([]);
		setKeywordFilterState([]);
		setYearFrom(YEAR_MIN);
		setYearTo(YEAR_MAX);
		onPageReset?.();
	}

	const value: FilterContextValue = {
		authorFilter,
		journalFilter,
		keywordFilter,
		yearFrom,
		yearTo,
		sortBy,
		activeFilterCount,
		setAuthorFilter,
		setJournalFilter,
		setKeywordFilter,
		setYearRange,
		setSortBy,
		clearAllFilters,
		YEAR_MIN,
		YEAR_MAX,
	};

	return (
		<FilterContext.Provider value={value}>{children}</FilterContext.Provider>
	);
}

export { FilterContext };
