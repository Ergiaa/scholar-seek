import { sleep } from "bun";
import { XMLParser } from "fast-xml-parser";
import { DOAJ_LCC_TERMS } from "../source-taxonomies";
import { type HarvestUnit, harvestUnitsSequentially } from "./oai-pmh";
import type { CrawlOptions, NewPaper, SourceAdapter } from "./types";

// Targets store the human-readable LCC label (matching what the taxonomy
// picker shows) — the opaque setSpec token isn't derivable from it, so it's
// looked up here at request-build time rather than stored on the target.
const LABEL_TO_SET_SPEC = new Map(
	DOAJ_LCC_TERMS.map((t) => [t.label, t.setSpec])
);

const OAI_BASE = "https://doaj.org/oai.article";
const BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 1100;
const MAX_RETRIES = 3;

// Only the language scoping the old REST version enforced (Indonesian-only
// journals) needs to carry over. oai_doaj:language is a single three-letter
// ISO 639-2 code — "ind", not the REST version's two-letter "id".
const LANGUAGE_FILTER = "ind";

const WHITESPACE_RE = /\s+/g;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	removeNSPrefix: true,
	isArray: (name) =>
		["author", "keyword", "affiliationName", "record"].includes(name),
	parseTagValue: false,
	processEntities: { maxTotalExpansions: 100_000 },
});

interface DoajAuthor {
	name?: string;
}

interface DoajArticleMetadata {
	abstract?: string;
	authors?: { author?: DoajAuthor[] };
	doi?: string;
	fullTextUrl?: string | { "#text"?: string };
	journalTitle?: string;
	keywords?: { keyword?: string[] };
	language?: string;
	publicationDate?: string;
	title?: string;
}

interface OaiRecord {
	header?: { "@_status"?: string };
	metadata?: { doajArticle?: DoajArticleMetadata };
}

interface OaiResponse {
	"OAI-PMH"?: {
		ListRecords?: {
			record?: OaiRecord[];
			resumptionToken?:
				| string
				| { "#text"?: string; "@_completeListSize"?: string };
		};
		error?: { "#text"?: string; "@_code"?: string };
	};
}

function buildUrl(
	since: string | undefined,
	until: string | undefined,
	set: string | undefined,
	resumptionToken?: string
): string {
	if (resumptionToken) {
		return `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`;
	}

	const params = new URLSearchParams({
		verb: "ListRecords",
		metadataPrefix: "oai_doaj",
	});

	if (since) {
		params.set("from", since);
	}
	if (until) {
		params.set("until", until);
	}
	if (set) {
		params.set("set", set);
	}

	return `${OAI_BASE}?${params}`;
}

function extractResumptionToken(
	token:
		| string
		| { "#text"?: string; "@_completeListSize"?: string }
		| undefined
): string | undefined {
	if (!token) {
		return undefined;
	}
	if (typeof token === "string") {
		return token || undefined;
	}
	return token["#text"] || undefined;
}

function mapRecord(record: OaiRecord): NewPaper | null {
	if (record.header?.["@_status"] === "deleted") {
		return null;
	}

	const meta = record.metadata?.doajArticle;
	if (!meta?.title) {
		return null;
	}

	// The old REST version scoped every query to Indonesian-language journals
	// unconditionally (bibjson.journal.language:id) — a record with no
	// language at all wouldn't have matched that query either, so it's
	// excluded here too, not just records with a different language.
	if (meta.language?.trim() !== LANGUAGE_FILTER) {
		return null;
	}

	const doi = meta.doi?.trim() ?? null;
	const sourceUrl =
		(typeof meta.fullTextUrl === "object"
			? meta.fullTextUrl["#text"]
			: meta.fullTextUrl
		)?.trim() ?? (doi ? `https://doi.org/${doi}` : null);
	if (!sourceUrl) {
		return null;
	}

	let publishedAt: Date | null = null;
	if (meta.publicationDate) {
		const d = new Date(meta.publicationDate);
		if (!Number.isNaN(d.getTime())) {
			publishedAt = d;
		}
	}

	const keywords = (meta.keywords?.keyword ?? [])
		.map((k) => k.trim())
		.filter(Boolean);

	return {
		title: meta.title.replace(WHITESPACE_RE, " ").trim(),
		abstract: meta.abstract?.replace(WHITESPACE_RE, " ").trim() || null,
		authors: (meta.authors?.author ?? [])
			.map((a) => a.name?.trim())
			.filter((n): n is string => Boolean(n)),
		published_at: publishedAt,
		journal: meta.journalTitle?.trim() ?? null,
		doi,
		keywords: keywords.length > 0 ? [...new Set(keywords)] : null,
		source_url: sourceUrl,
		source: "doaj",
		source_id: sourceUrl,
		citation_count: 0,
		embedding_stored: false,
	};
}

async function fetchPage(
	url: string,
	attempt = 0
): Promise<{ records: NewPaper[]; resumptionToken?: string }> {
	let res: Response;

	try {
		res = await fetch(url);
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

	const xml = await res.text();
	const parsed = parser.parse(xml) as OaiResponse;
	const oai = parsed["OAI-PMH"];

	if (!oai) {
		throw new Error("Unexpected OAI-PMH response shape");
	}

	if (oai.error) {
		const code = oai.error["@_code"];
		const msg = oai.error["#text"];
		if (code === "noRecordsMatch") {
			return { records: [] };
		}
		throw new Error(`OAI-PMH error [${code}]: ${msg}`);
	}

	const listRecords = oai.ListRecords;
	if (!listRecords) {
		return { records: [] };
	}

	const rawRecords: OaiRecord[] = listRecords.record ?? [];
	const records = rawRecords
		.map(mapRecord)
		.filter((r): r is NewPaper => r !== null);
	const resumptionToken = extractResumptionToken(listRecords.resumptionToken);

	return { records, resumptionToken };
}

export const doajAdapter: SourceAdapter = {
	name: "doaj",

	async *crawl(
		options: CrawlOptions
	): AsyncGenerator<{ category: string | undefined; papers: NewPaper[] }> {
		const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
		// DOAJ has no top-level/subcode structure — every selected LCC term is
		// its own full harvest, no exceptions. No categories means one harvest
		// across the whole repository, no set filter.
		const labels = options.categories ?? [];
		const units: HarvestUnit<NewPaper>[] =
			labels.length > 0
				? labels.map((label) => {
						const setSpec = LABEL_TO_SET_SPEC.get(label);
						if (!setSpec) {
							throw new Error(`Unknown DOAJ LCC term: "${label}"`);
						}
						return {
							category: label,
							buildInitialUrl: () =>
								buildUrl(options.since, options.until, setSpec, undefined),
							buildResumeUrl: (token: string) =>
								buildUrl(undefined, undefined, undefined, token),
						};
					})
				: [
						{
							category: undefined,
							buildInitialUrl: () =>
								buildUrl(options.since, options.until, undefined, undefined),
							buildResumeUrl: (token: string) =>
								buildUrl(undefined, undefined, undefined, token),
						},
					];

		yield* harvestUnitsSequentially(
			units,
			fetchPage,
			maxRecords,
			BATCH_SIZE,
			REQUEST_DELAY_MS
		);
	},
};
