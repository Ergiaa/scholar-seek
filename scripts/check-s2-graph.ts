/**
 * Tests the Semantic Scholar Graph API against our real data.
 *
 * Usage:
 *   bun scripts/check-s2-graph.ts
 *
 * 1. `/paper/search/bulk` — the candidate "second source" endpoint:
 *    runs a filtered query and reports total matches and page shape.
 * 2. `/paper/batch` — the candidate enrichment endpoint: pulls arXiv IDs
 *    from our own papers table and compares S2 citation counts with the
 *    citation_count we have stored (always 0 from OAI-PMH).
 *
 * Works unauthenticated (shared public rate-limit pool). Set S2_API_KEY
 * to use a dedicated key instead.
 */

import { SQL } from "bun";
import { config } from "dotenv";

config({ path: "packages/db/.env", quiet: true });

const GRAPH_BASE = "https://api.semanticscholar.org/graph/v1";
const BATCH_SAMPLE_SIZE = 100;

const headers: Record<string, string> = process.env.S2_API_KEY
	? { "x-api-key": process.env.S2_API_KEY }
	: {};

interface BulkSearchResponse {
	data: { citationCount: number; title: string; year: number }[];
	token?: string;
	total: number;
}

interface BatchPaper {
	citationCount: number;
	externalIds?: { ArXiv?: string };
	influentialCitationCount: number;
	title: string;
	venue: string;
}

async function testBulkSearch() {
	const params = new URLSearchParams({
		query: "large language models",
		fields: "title,year,citationCount,externalIds",
		fieldsOfStudy: "Computer Science",
		year: "2024-",
	});

	const started = performance.now();
	const res = await fetch(`${GRAPH_BASE}/paper/search/bulk?${params}`, {
		headers,
	});
	const elapsed = Math.round(performance.now() - started);

	console.log(`1. search/bulk — HTTP ${res.status} in ${elapsed}ms`);
	if (!res.ok) {
		console.log(`   ${await res.text()}`);
		return;
	}

	const body = (await res.json()) as BulkSearchResponse;
	console.log(`   query="large language models", fieldsOfStudy=CS, year=2024-`);
	console.log(`   total matches: ${body.total.toLocaleString()}`);
	console.log(
		`   page size: ${body.data.length}, continuation token: ${body.token ? "yes" : "no"}`
	);
	const first = body.data[0];
	if (first) {
		console.log(
			`   first record: "${first.title.slice(0, 70)}..." (${first.year}, ${first.citationCount} citations)`
		);
	}
}

async function getLocalArxivIds(): Promise<string[]> {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.log("\n(DATABASE_URL not set — skipping batch enrichment test)");
		return [];
	}
	const sql = new SQL(databaseUrl);
	const rows = (await sql`
		SELECT source_id FROM papers
		WHERE source = 'arxiv' AND source_id IS NOT NULL
		ORDER BY published_at DESC NULLS LAST
		LIMIT ${BATCH_SAMPLE_SIZE}
	`) as { source_id: string }[];
	await sql.close();
	return rows.map((r) => r.source_id);
}

async function testBatchEnrichment() {
	const ids = await getLocalArxivIds();
	if (ids.length === 0) {
		return;
	}

	const started = performance.now();
	const res = await fetch(
		`${GRAPH_BASE}/paper/batch?fields=title,citationCount,influentialCitationCount,venue,externalIds`,
		{
			body: JSON.stringify({ ids: ids.map((id) => `ARXIV:${id}`) }),
			headers: { ...headers, "Content-Type": "application/json" },
			method: "POST",
		}
	);
	const elapsed = Math.round(performance.now() - started);

	console.log(`\n2. paper/batch — HTTP ${res.status} in ${elapsed}ms`);
	if (!res.ok) {
		console.log(`   ${await res.text()}`);
		return;
	}

	const results = (await res.json()) as (BatchPaper | null)[];
	const matched = results.filter((r): r is BatchPaper => r !== null);
	const withCitations = matched.filter((r) => r.citationCount > 0);
	const totalCitations = matched.reduce((sum, r) => sum + r.citationCount, 0);
	const withVenue = matched.filter((r) => r.venue && r.venue !== "arXiv.org");

	console.log(
		`   sent ${ids.length} arXiv IDs from our DB -> ${matched.length} matched (${Math.round((matched.length / ids.length) * 100)}%)`
	);
	console.log(
		`   ${withCitations.length} papers have citations on S2 (our DB stores 0 for all of them)`
	);
	console.log(
		`   total citations we're missing: ${totalCitations.toLocaleString()}`
	);
	console.log(`   ${withVenue.length} papers have a real publication venue`);

	const top = [...matched]
		.sort((a, b) => b.citationCount - a.citationCount)
		.slice(0, 5);
	console.log("\n   Most-cited papers in our DB according to S2:");
	for (const p of top) {
		console.log(
			`   ${String(p.citationCount).padStart(6)}  "${p.title.slice(0, 65)}"`
		);
	}
}

console.log(
	`Semantic Scholar Graph API test (${process.env.S2_API_KEY ? "authenticated" : "unauthenticated, shared pool"})\n`
);
await testBulkSearch();
await testBatchEnrichment();
