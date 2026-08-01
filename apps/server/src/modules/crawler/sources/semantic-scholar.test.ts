import { afterEach, describe, expect, it, mock } from "bun:test";
import type { NewPaper } from "@scholar-seek/db/schema/papers";
import { semanticScholarAdapter } from "./semantic-scholar";

async function collect(
	gen: AsyncGenerator<{ category: string | undefined; papers: NewPaper[] }>
): Promise<NewPaper[]> {
	const out: NewPaper[] = [];
	for await (const { papers } of gen) {
		out.push(...papers);
	}
	return out;
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

type FetchFn = (
	input: RequestInfo | URL,
	init?: RequestInit
) => Promise<Response>;

function setFetch(fn: FetchFn) {
	globalThis.fetch = mock(fn) as unknown as typeof fetch;
}

const REQUIRES_QUERY_RE = /requires a "query"/;
const HTTP_500_RE = /HTTP 500/;

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("semanticScholarAdapter.crawl", () => {
	it("throws when no query is provided", async () => {
		await expect(collect(semanticScholarAdapter.crawl({}))).rejects.toThrow(
			REQUIRES_QUERY_RE
		);
	});

	it("maps a valid paper, preferring the arXiv source identity", async () => {
		setFetch(() =>
			Promise.resolve(
				jsonResponse({
					total: 1,
					token: null,
					data: [
						{
							paperId: "s2-1",
							title: "A Semantic Scholar Paper",
							abstract: "  An abstract.  ",
							authors: [{ name: "Jane Doe" }],
							year: 2018,
							publicationDate: "2018-04-01",
							journal: { name: "Journal of Search" },
							externalIds: { ArXiv: "1804.00001", DOI: "10.1/xyz" },
							citationCount: 42,
							s2FieldsOfStudy: [{ category: "Computer Science" }],
						},
					],
				})
			)
		);

		const papers = await collect(
			semanticScholarAdapter.crawl({ query: "large language models" })
		);

		expect(papers).toHaveLength(1);
		const paper = papers[0];
		expect(paper?.title).toBe("A Semantic Scholar Paper");
		expect(paper?.abstract).toBe("An abstract.");
		expect(paper?.source).toBe("arxiv");
		expect(paper?.source_id).toBe("1804.00001");
		expect(paper?.source_url).toBe("https://arxiv.org/abs/1804.00001");
		expect(paper?.citation_count).toBe(42);
		expect(paper?.keywords).toEqual(["Computer Science"]);
	});

	it("throws on a non-retryable HTTP error", async () => {
		setFetch(() => Promise.resolve(jsonResponse({}, 500)));

		await expect(
			collect(semanticScholarAdapter.crawl({ query: "test" }))
		).rejects.toThrow(HTTP_500_RE);
	});
});
