import { sleep } from "bun";
import type { CrawlOptions, NewPaper, SourceAdapter } from "./types";

const API_BASE = "https://doaj.org/api/v3/search/articles";
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 1100;
const MAX_RETRIES = 3;

/**
 * Maps Semantic Scholar field-of-study names to DOAJ LCC subject terms.
 * Used to translate the shared `categories` option into DOAJ query filters.
 * Fallback: unrecognised strings are passed through as-is.
 */
const S2_TO_LCC: Record<string, string> = {
	"Computer Science": "Computer science",
	Mathematics: "Mathematics",
	Physics: "Physics",
	Biology: "Biology (General)",
	Chemistry: "Chemistry",
	Medicine: "Medicine",
	Engineering: "Engineering (General). Civil engineering (General)",
	Economics: "Economics as a science",
	Psychology: "Psychology",
	Sociology: "Sociology (General)",
	History: "History (General) and history of Europe",
	Philosophy: "Philosophy (General)",
	Art: "Arts in general",
	"Political Science": "Political science (General)",
	Geography: "Geography (General)",
	Geology: "Geology",
	"Environmental Science": "Environmental sciences",
	"Materials Science": "Materials of engineering and construction. Mechanics of materials",
	Linguistics: "Language and languages",
	Education: "Education (General)",
	Law: "Law in general. Comparative and uniform law. Jurisprudence",
	Business: "Business",
	"Agricultural and Food Sciences": "Agriculture (General)",
	"Art and Humanities": "Arts in general",
	"Social Sciences": "Social sciences (General)",
};

interface DoajAuthor {
	name?: string;
}

interface DoajIdentifier {
	id?: string;
	type?: string;
}

interface DoajLink {
	type?: string;
	url?: string;
}

interface DoajSubject {
	scheme?: string;
	term?: string;
}

interface DoajJournal {
	language?: string[];
	title?: string;
}

interface DoajBibjson {
	abstract?: string;
	author?: DoajAuthor[];
	identifier?: DoajIdentifier[];
	journal?: DoajJournal;
	keywords?: string[];
	link?: DoajLink[];
	month?: string;
	subject?: DoajSubject[];
	title?: string;
	year?: string;
}

interface DoajArticle {
	bibjson?: DoajBibjson;
	id?: string;
}

interface DoajSearchResponse {
	results?: DoajArticle[];
	total?: number;
	page?: number;
	pageSize?: number;
}

function categoryToLcc(category: string): string {
	return S2_TO_LCC[category] ?? category;
}

function buildQuery(options: CrawlOptions): string {
	const clauses: string[] = [];

	// Always restrict to Indonesian-language journals
	clauses.push("bibjson.journal.language:id");

	if (options.query?.trim()) {
		clauses.push(options.query.trim());
	}

	if (options.categories?.length) {
		const subjectClauses = options.categories
			.map((c) => `bibjson.subject.term:"${categoryToLcc(c)}"`)
			.join(" OR ");
		clauses.push(`(${subjectClauses})`);
	}

	if (options.since && options.until) {
		const from = options.since.slice(0, 4);
		const to = options.until.slice(0, 4);
		clauses.push(`bibjson.year:[${from} TO ${to}]`);
	} else if (options.since) {
		clauses.push(`bibjson.year:>=${options.since.slice(0, 4)}`);
	} else if (options.until) {
		clauses.push(`bibjson.year:<=${options.until.slice(0, 4)}`);
	}

	return clauses.join(" AND ");
}

function buildUrl(options: CrawlOptions, page: number): string {
	const query = buildQuery(options);
	const params = new URLSearchParams({
		pageSize: String(PAGE_SIZE),
		page: String(page),
	});
	return `${API_BASE}/${encodeURIComponent(query)}?${params}`;
}

function mapArticle(article: DoajArticle): NewPaper | null {
	const bib = article.bibjson;
	if (!bib?.title) {
		return null;
	}

	const doi =
		bib.identifier?.find((i) => i.type === "doi")?.id?.trim() ?? null;

	const sourceUrl =
		bib.link?.find((l) => l.type === "fulltext")?.url?.trim() ??
		(doi ? `https://doi.org/${doi}` : null);

	if (!sourceUrl) {
		return null;
	}

	let publishedAt: Date | null = null;
	if (bib.year) {
		const dateStr = bib.month
			? `${bib.year}-${bib.month.padStart(2, "0")}-01`
			: `${bib.year}-01-01`;
		const d = new Date(dateStr);
		if (!Number.isNaN(d.getTime())) {
			publishedAt = d;
		}
	}

	const keywords = [
		...(bib.keywords ?? []),
		...(bib.subject ?? [])
			.map((s) => s.term)
			.filter((t): t is string => Boolean(t)),
	];

	return {
		title: bib.title.trim(),
		abstract: bib.abstract?.trim() || null,
		authors: (bib.author ?? [])
			.map((a) => a.name)
			.filter((n): n is string => Boolean(n)),
		published_at: publishedAt,
		journal: bib.journal?.title?.trim() ?? null,
		doi,
		keywords: keywords.length > 0 ? [...new Set(keywords)] : null,
		source_url: sourceUrl,
		source: "doaj",
		source_id: article.id ?? sourceUrl,
		citation_count: 0,
		embedding_stored: false,
	};
}

async function fetchPage(
	url: string,
	attempt = 0
): Promise<DoajSearchResponse> {
	let res: Response;

	try {
		res = await fetch(url, {
			headers: { Accept: "application/json" },
		});
	} catch (err) {
		if (attempt < MAX_RETRIES) {
			await sleep(REQUEST_DELAY_MS * (attempt + 1));
			return fetchPage(url, attempt + 1);
		}
		throw new Error(
			`DOAJ fetch failed after ${MAX_RETRIES} retries: ${String(err)}`
		);
	}

	if (res.status === 429) {
		const delay = REQUEST_DELAY_MS * 2 ** attempt;
		if (attempt < MAX_RETRIES) {
			await sleep(delay);
			return fetchPage(url, attempt + 1);
		}
		throw new Error("DOAJ rate limit exceeded — too many retries");
	}

	if (!res.ok) {
		throw new Error(`DOAJ responded with HTTP ${res.status}`);
	}

	return (await res.json()) as DoajSearchResponse;
}

export const doajAdapter: SourceAdapter = {
	name: "doaj",

	async *crawl(options: CrawlOptions): AsyncGenerator<NewPaper[]> {
		const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
		let page = 1;
		let totalYielded = 0;

		while (true) {
			const data = await fetchPage(buildUrl(options, page));
			const results = data.results ?? [];

			if (results.length === 0) {
				break;
			}

			const records = results
				.map(mapArticle)
				.filter((r): r is NewPaper => r !== null);

			if (records.length > 0) {
				const batch = records.slice(0, maxRecords - totalYielded);
				for (let i = 0; i < batch.length; i += PAGE_SIZE) {
					yield batch.slice(i, i + PAGE_SIZE);
				}
				totalYielded += batch.length;
			}

			const total = data.total ?? 0;
			if (
				totalYielded >= maxRecords ||
				page * PAGE_SIZE >= total ||
				results.length < PAGE_SIZE
			) {
				break;
			}

			page++;
			await sleep(REQUEST_DELAY_MS);
		}
	},
};
