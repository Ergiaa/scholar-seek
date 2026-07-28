import { env } from "@scholar-seek/env/server";
import { sleep } from "bun";
import type { CrawlOptions, NewPaper, SourceAdapter } from "./types";

const BULK_SEARCH_URL =
	"https://api.semanticscholar.org/graph/v1/paper/search/bulk";
const FIELDS =
	"title,abstract,authors,year,publicationDate,venue,journal,externalIds,citationCount,s2FieldsOfStudy";
const BATCH_SIZE = 100;
// With an API key the limit is 1 req/s; unauthenticated shares a global pool.
const REQUEST_DELAY_MS = 1100;
const MAX_RETRIES = 5;

interface S2Paper {
	abstract?: string | null;
	authors?: { name?: string }[];
	citationCount?: number;
	externalIds?: { ArXiv?: string; DOI?: string };
	journal?: { name?: string } | null;
	paperId: string;
	publicationDate?: string | null;
	s2FieldsOfStudy?: { category?: string }[] | null;
	title?: string;
	url?: string;
	venue?: string;
	year?: number | null;
}

interface BulkSearchResponse {
	data?: S2Paper[];
	token?: string | null;
	total?: number;
}

function buildUrl(options: CrawlOptions, token?: string): string {
	const params = new URLSearchParams({
		query: options.query ?? "",
		fields: FIELDS,
	});

	if (options.categories?.length) {
		params.set("fieldsOfStudy", options.categories.join(","));
	}

	if (options.since || options.until) {
		params.set(
			"publicationDateOrYear",
			`${options.since ?? ""}:${options.until ?? ""}`
		);
	}

	if (token) {
		params.set("token", token);
	}

	return `${BULK_SEARCH_URL}?${params}`;
}

function mapPaper(paper: S2Paper): NewPaper | null {
	if (!paper.title) {
		return null;
	}

	const arxivId = paper.externalIds?.ArXiv;
	const doi = paper.externalIds?.DOI ?? null;

	let publishedAt: Date | null = null;
	if (paper.publicationDate) {
		const d = new Date(paper.publicationDate);
		if (!Number.isNaN(d.getTime())) {
			publishedAt = d;
		}
	} else if (paper.year) {
		publishedAt = new Date(`${paper.year}-01-01T00:00:00Z`);
	}

	const keywords = [
		...new Set(
			(paper.s2FieldsOfStudy ?? [])
				.map((f) => f.category)
				.filter((c): c is string => Boolean(c))
		),
	];

	// Prefer the original source; fall back to the Semantic Scholar page.
	let sourceUrl = `https://www.semanticscholar.org/paper/${paper.paperId}`;
	if (arxivId) {
		sourceUrl = `https://arxiv.org/abs/${arxivId}`;
	} else if (doi) {
		sourceUrl = `https://doi.org/${doi}`;
	}

	return {
		title: paper.title.trim(),
		abstract: paper.abstract?.trim() || null,
		authors: (paper.authors ?? [])
			.map((a) => a.name)
			.filter((n): n is string => Boolean(n)),
		published_at: publishedAt,
		journal: paper.journal?.name?.trim() || paper.venue?.trim() || null,
		doi,
		keywords: keywords.length > 0 ? keywords : null,
		source_url: sourceUrl,
		// Papers that exist on arXiv keep the arxiv identity so the upsert on
		// (source, source_id) merges with rows from the OAI-PMH crawler instead
		// of creating duplicates — and enriches them with citation counts.
		source: arxivId ? "arxiv" : "semantic_scholar",
		source_id: arxivId ?? paper.paperId,
		citation_count: paper.citationCount ?? 0,
		embedding_stored: false,
	};
}

/** Drop batch-internal DOI duplicates so the multi-row insert can't collide with itself. */
function dedupeByDoi(records: NewPaper[]): NewPaper[] {
	const seen = new Set<string>();
	return records.filter((r) => {
		if (!r.doi) {
			return true;
		}
		if (seen.has(r.doi)) {
			return false;
		}
		seen.add(r.doi);
		return true;
	});
}

async function fetchPage(
	url: string,
	attempt = 0
): Promise<BulkSearchResponse> {
	const headers: Record<string, string> = env.S2_API_KEY
		? { "x-api-key": env.S2_API_KEY }
		: {};

	let res: Response;
	try {
		res = await fetch(url, { headers });
	} catch (err) {
		if (attempt < MAX_RETRIES) {
			await sleep(REQUEST_DELAY_MS * (attempt + 1));
			return fetchPage(url, attempt + 1);
		}
		throw new Error(
			`Semantic Scholar fetch failed after ${MAX_RETRIES} retries: ${String(err)}`
		);
	}

	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
		const delay =
			retryAfter > 0 ? retryAfter * 1000 : REQUEST_DELAY_MS * 2 ** attempt;

		if (attempt < MAX_RETRIES) {
			await sleep(delay);
			return fetchPage(url, attempt + 1);
		}
		throw new Error("Semantic Scholar rate limit exceeded — too many retries");
	}

	if (!res.ok) {
		throw new Error(`Semantic Scholar responded with HTTP ${res.status}`);
	}

	return (await res.json()) as BulkSearchResponse;
}

export const semanticScholarAdapter: SourceAdapter = {
	name: "semantic_scholar",

	async *crawl(options: CrawlOptions): AsyncGenerator<NewPaper[]> {
		if (!options.query?.trim()) {
			throw new Error(
				'The semantic_scholar source requires a "query" option (e.g. "large language models")'
			);
		}

		const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
		let totalYielded = 0;
		let token: string | undefined;

		while (true) {
			const page = await fetchPage(buildUrl(options, token));
			const records = dedupeByDoi(
				(page.data ?? []).map(mapPaper).filter((r): r is NewPaper => r !== null)
			);

			if (records.length > 0) {
				const batch = records.slice(0, maxRecords - totalYielded);
				for (let i = 0; i < batch.length; i += BATCH_SIZE) {
					yield batch.slice(i, i + BATCH_SIZE);
				}
				totalYielded += batch.length;
			}

			token = page.token ?? undefined;
			if (!token || totalYielded >= maxRecords) {
				break;
			}
			await sleep(REQUEST_DELAY_MS);
		}
	},
};
