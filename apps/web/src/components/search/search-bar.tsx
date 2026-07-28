import { Button } from "@scholar-seek/ui/components/button";
import { Input } from "@scholar-seek/ui/components/input";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FIELDS_OF_STUDY, SEARCH_IN_OPTIONS } from "../../lib/constants";
import type { SearchIn, SearchMode } from "../../types/paper";

export interface SearchSubmit {
	field?: string;
	q: string;
	searchIn: SearchIn;
	searchMode: SearchMode;
}

interface SearchBarProps {
	defaultField?: string;
	defaultSearchIn?: SearchIn;
	defaultSearchMode?: SearchMode;
	defaultValue?: string;
	onSearch?: (params: SearchSubmit) => void;
}

export function SearchBar({
	defaultValue = "",
	defaultSearchIn = "all",
	defaultSearchMode = "standard",
	defaultField = "",
	onSearch,
}: SearchBarProps) {
	const [query, setQuery] = useState(defaultValue);
	const [searchIn, setSearchIn] = useState<SearchIn>(defaultSearchIn);
	const [searchMode, setSearchMode] = useState<SearchMode>(defaultSearchMode);
	const [field, setField] = useState(defaultField);
	const inputRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.key === "/" &&
				document.activeElement?.tagName !== "INPUT" &&
				document.activeElement?.tagName !== "TEXTAREA" &&
				document.activeElement?.tagName !== "SELECT"
			) {
				e.preventDefault();
				inputRef.current?.focus();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = query.trim();
		if (!trimmed) {
			return;
		}
		const params: SearchSubmit = {
			q: trimmed,
			searchIn,
			searchMode,
			field: field || undefined,
		};
		if (onSearch) {
			onSearch(params);
		} else {
			navigate({
				to: "/search",
				search: {
					q: params.q,
					searchIn: searchIn === "all" ? undefined : searchIn,
					searchMode,
					field: params.field,
				},
			});
		}
	};

	const selectClass =
		"h-8 rounded-md border border-input bg-background px-2 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring";

	return (
		<form className="w-full" onSubmit={handleSubmit}>
			<div className="relative flex w-full items-center">
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute left-4 h-5 w-5 text-muted-foreground"
				/>
				<Input
					autoComplete="off"
					className="h-14 w-full rounded-lg border-0 bg-transparent pr-40 pl-12 text-lg shadow-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
					name="q"
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search for articles, authors, or topics…"
					ref={inputRef}
					type="search"
					value={query}
				/>
				<div className="absolute right-2 flex items-center gap-2">
					<div className="pointer-events-none mr-2 hidden items-center gap-1 rounded border bg-muted/50 px-2 py-1 font-medium text-muted-foreground text-xs sm:flex">
						<span>/</span>
					</div>
					<Button className="h-10 rounded-md px-6" size="lg" type="submit">
						Search
					</Button>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5">
				<div className="flex items-center gap-1.5 text-muted-foreground text-sm">
					<span className="shrink-0">Mode</span>
					<div className="flex overflow-hidden rounded-md border border-input">
						<button
							className={`px-3 py-1 text-xs transition-colors ${searchMode === "standard" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
							onClick={() => setSearchMode("standard")}
							title="Standard keyword search"
							type="button"
						>
							Standard
						</button>
						<button
							className={`px-3 py-1 text-xs transition-colors ${searchMode === "ml" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
							onClick={() => setSearchMode("ml")}
							title="Semantic ML search with query expansion"
							type="button"
						>
							ML Search
						</button>
					</div>
				</div>

				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<label className="shrink-0" htmlFor="search-in-select">
						Search in
					</label>
					<select
						className={selectClass}
						id="search-in-select"
						onChange={(e) => setSearchIn(e.target.value as SearchIn)}
						value={searchIn}
					>
						{SEARCH_IN_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				</div>

				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<label className="shrink-0" htmlFor="field-select">
						Field of study
					</label>
					<select
						className={`${selectClass} max-w-52`}
						id="field-select"
						onChange={(e) => setField(e.target.value)}
						value={field}
					>
						<option value="">All fields of study</option>
						{FIELDS_OF_STUDY.map((f) => (
							<option key={f} value={f}>
								{f}
							</option>
						))}
					</select>
				</div>

				{searchMode === "ml" && (
					<span className="text-muted-foreground text-xs italic">
						Semantic search · results ranked by BM25 + dense embeddings
					</span>
				)}
			</div>
		</form>
	);
}
