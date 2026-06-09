import { Button } from "@scholar-seek/ui/components/button";
import { Input } from "@scholar-seek/ui/components/input";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface SearchBarProps {
	defaultValue?: string;
	onSearch?: (query: string) => void;
}

export function SearchBar({ defaultValue = "", onSearch }: SearchBarProps) {
	const [query, setQuery] = useState(defaultValue);
	const inputRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.key === "/" &&
				document.activeElement?.tagName !== "INPUT" &&
				document.activeElement?.tagName !== "TEXTAREA"
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
		if (onSearch) {
			onSearch(trimmed);
		} else {
			navigate({ to: "/search", search: { q: trimmed } });
		}
	};

	return (
		<form className="relative flex w-full items-center" onSubmit={handleSubmit}>
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
		</form>
	);
}
