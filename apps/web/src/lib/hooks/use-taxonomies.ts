import type { MultiSelectOption } from "@scholar-seek/ui/components/multi-select";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/treaty";
import type { CrawlSource } from "./use-schedules";

interface ArxivCategory {
	code: string;
	name: string;
}

interface ArxivArchive {
	archive: string;
	categories: ArxivCategory[];
	label: string;
}

interface ArxivSuperGroup {
	archives: ArxivArchive[];
	label: string;
	superGroup: string;
}

interface DoajLccTerm {
	label: string;
	setSpec: string;
}

interface Taxonomies {
	arxiv: ArxivSuperGroup[];
	doaj: DoajLccTerm[];
	semanticScholar: readonly string[];
}

export function useTaxonomies() {
	return useQuery({
		queryKey: ["crawl-taxonomies"],
		queryFn: async () => {
			const { data, error } = await api.api.crawl.taxonomies.get();
			if (error) {
				throw new Error("Failed to load category taxonomies");
			}
			return data as Taxonomies;
		},
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function categoryOptionsFor(
	source: CrawlSource | undefined,
	taxonomies: Taxonomies | undefined
): MultiSelectOption[] {
	if (!(source && taxonomies)) {
		return [];
	}
	if (source === "arxiv") {
		return taxonomies.arxiv.flatMap((group) =>
			group.archives.flatMap((archive) =>
				archive.categories.map((category) => ({
					value: category.code,
					label: `${archive.label}: ${category.name} (${category.code})`,
				}))
			)
		);
	}
	if (source === "doaj") {
		return taxonomies.doaj.map((term) => ({
			value: term.setSpec,
			label: term.label,
		}));
	}
	return taxonomies.semanticScholar.map((field) => ({
		value: field,
		label: field,
	}));
}
