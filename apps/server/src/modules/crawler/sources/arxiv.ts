import { sleep } from "bun";
import { XMLParser } from "fast-xml-parser";
import { type HarvestUnit, harvestUnitsSequentially } from "./oai-pmh";
import type { CrawlOptions, NewPaper, SourceAdapter } from "./types";

const OAI_BASE = "https://export.arxiv.org/oai2";
const BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 3000;
const MAX_RETRIES = 3;

const WHITESPACE_RE = /\s+/g;

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	isArray: (name) => ["author", "category", "record", "header"].includes(name),
	// ArXiv IDs (e.g. "2101.00001") look like floats — keep all tag values as strings.
	parseTagValue: false,
	// ArXiv OAI-PMH pages return ~1000 records each with many XML entities
	// (&amp;, &lt;, etc.) in abstracts and titles. Raise the limit beyond the
	// default of 1000 to avoid false positives on legitimate payloads.
	processEntities: { maxTotalExpansions: 100_000 },
});

interface ArxivAuthorObj {
	forenames?: string;
	keyname?: string;
}

type ArxivAuthor = ArxivAuthorObj | string;

interface ArxivMetadata {
	abstract?: string;
	authors?: { author?: ArxivAuthor[] };
	categories?: string;
	created?: string;
	// doi can be an object when it carries XML attributes (e.g. type="doi")
	doi?: string | { "#text"?: string };
	id?: string;
	// ArXiv XML tag is <journal-ref>, not <journal_ref>
	"journal-ref"?: string;
	title?: string;
}

interface OaiRecord {
	header?: { status?: string };
	metadata?: { arXiv?: ArxivMetadata };
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
		metadataPrefix: "arXiv",
	});

	if (since) {
		params.set("from", since);
	}
	if (until) {
		params.set("until", until);
	}
	// OAI-PMH only supports top-level sets (e.g. "cs", "math").
	if (set) {
		params.set("set", set);
	}

	return `${OAI_BASE}?${params}`;
}

/**
 * Groups requested categories by top-level prefix (e.g. "cs.LG", "cs.AI" ->
 * group "cs"; "astro-ph.GA" -> group "astro-ph"). Each distinct group gets
 * its own full harvest — a single OAI-PMH `set` fetch only ever returns one
 * group's papers, so a target spanning groups needs one harvest per group,
 * not one fetch post-filtered against every requested code (the latter is
 * the pre-existing bug this fixes: papers from any group other than the
 * first-requested category's group could never match, and silently never
 * appeared).
 *
 * A bare top-level category (no ".") means "whole group, no subfilter" —
 * `null` in the returned map signals that; once a group is marked `null` it
 * stays that way even if a subcode for the same group is also present.
 */
function groupCategories(
	categories: string[]
): Map<string, string[] | null> {
	const groups = new Map<string, string[] | null>();
	for (const cat of categories) {
		const group = cat.split(".")[0];
		if (!group) {
			continue;
		}
		if (!cat.includes(".")) {
			groups.set(group, null);
			continue;
		}
		const existing = groups.get(group);
		if (existing === null) {
			continue;
		}
		const subcodes = existing ?? [];
		subcodes.push(cat);
		groups.set(group, subcodes);
	}
	return groups;
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

function formatAuthor(author: ArxivAuthor): string {
	if (typeof author === "string") {
		return author;
	}
	const parts = [author.forenames, author.keyname].filter(Boolean);
	return parts.join(" ");
}

function mapRecord(record: OaiRecord): NewPaper | null {
	// Skip deleted records
	if (record.header?.status === "deleted") {
		return null;
	}

	const meta = record.metadata?.arXiv;
	if (!(meta?.id && meta.title)) {
		return null;
	}

	const arxivId = meta.id.trim();
	const title = meta.title.replace(WHITESPACE_RE, " ").trim();
	const abstract = meta.abstract?.replace(WHITESPACE_RE, " ").trim() ?? null;

	const authors: string[] = (meta.authors?.author ?? []).map(formatAuthor);

	const categories = meta.categories
		? meta.categories.split(WHITESPACE_RE).filter(Boolean)
		: [];

	let publishedAt: Date | null = null;
	if (meta.created) {
		const d = new Date(meta.created);
		if (!Number.isNaN(d.getTime())) {
			publishedAt = d;
		}
	}

	return {
		title,
		abstract,
		authors,
		published_at: publishedAt,
		journal: meta["journal-ref"]?.trim() ?? null,
		doi:
			(typeof meta.doi === "object" ? meta.doi["#text"] : meta.doi)?.trim() ??
			null,
		keywords: categories.length > 0 ? categories : null,
		source_url: `https://arxiv.org/abs/${arxivId}`,
		source: "arxiv",
		source_id: arxivId,
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
			`ArXiv fetch failed after ${MAX_RETRIES} retries: ${String(err)}`
		);
	}

	if (res.status === 503) {
		const retryAfter = Number(res.headers.get("Retry-After") ?? 30);
		const delay = Number.isNaN(retryAfter) ? 30_000 : retryAfter * 1000;

		if (attempt < MAX_RETRIES) {
			await sleep(delay);
			return fetchPage(url, attempt + 1);
		}
		throw new Error("ArXiv rate limit exceeded — too many retries");
	}

	if (!res.ok) {
		throw new Error(`ArXiv responded with HTTP ${res.status}`);
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
		// noRecordsMatch is not an error — it just means the date range has no results
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

export const arxivAdapter: SourceAdapter = {
	name: "arxiv",

	async *crawl(
		options: CrawlOptions
	): AsyncGenerator<{ category: string | undefined; papers: NewPaper[] }> {
		const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
		const groups = groupCategories(options.categories ?? []);

		const groupEntries: [string | undefined, string[] | null][] =
			groups.size > 0 ? [...groups.entries()] : [[undefined, null]];

		const units: HarvestUnit<NewPaper>[] = groupEntries.map(
			([group, subcodes]) => ({
				category: group,
				buildInitialUrl: () =>
					buildUrl(options.since, options.until, group, undefined),
				buildResumeUrl: (token: string) =>
					buildUrl(undefined, undefined, undefined, token),
				filterRecords: subcodes
					? (records) =>
							records.filter((p) => p.keywords?.some((k) => subcodes.includes(k)))
					: undefined,
			})
		);

		yield* harvestUnitsSequentially(
			units,
			fetchPage,
			maxRecords,
			BATCH_SIZE,
			REQUEST_DELAY_MS
		);
	},
};
