import { afterEach, describe, expect, it, mock } from "bun:test";
import type { NewPaper } from "@scholar-seek/db/schema/papers";
import { doajAdapter } from "./doaj";

type FetchFn = (
	input: RequestInfo | URL,
	init?: RequestInit
) => Promise<Response>;

function setFetch(fn: FetchFn) {
	globalThis.fetch = mock(fn) as unknown as typeof fetch;
}

async function collect(gen: AsyncGenerator<NewPaper[]>): Promise<NewPaper[]> {
	const out: NewPaper[] = [];
	for await (const batch of gen) {
		out.push(...batch);
	}
	return out;
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const HTTP_500_RE = /HTTP 500/;

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("doajAdapter.crawl", () => {
	it("maps a valid article into a NewPaper and stops when the page is short", async () => {
		setFetch(() =>
			Promise.resolve(
				jsonResponse({
					total: 1,
					results: [
						{
							id: "abc123",
							bibjson: {
								title: "A DOAJ Article",
								abstract: "  An abstract.  ",
								author: [{ name: "Jane Doe" }],
								year: "2019",
								month: "3",
								journal: { title: "Journal of Openness" },
								identifier: [{ type: "doi", id: "10.5678/xyz" }],
								link: [
									{ type: "fulltext", url: "https://doaj.org/article/abc123" },
								],
								subject: [{ term: "Computer science" }],
							},
						},
					],
				})
			)
		);

		const papers = await collect(doajAdapter.crawl({}));

		expect(papers).toHaveLength(1);
		const paper = papers[0];
		expect(paper?.title).toBe("A DOAJ Article");
		expect(paper?.abstract).toBe("An abstract.");
		expect(paper?.authors).toEqual(["Jane Doe"]);
		expect(paper?.doi).toBe("10.5678/xyz");
		expect(paper?.source_url).toBe("https://doaj.org/article/abc123");
		expect(paper?.journal).toBe("Journal of Openness");
		expect(paper?.keywords).toEqual(["Computer science"]);
		expect(paper?.published_at?.toISOString().slice(0, 7)).toBe("2019-03");
	});

	it("throws on a non-retryable HTTP error", async () => {
		setFetch(() => Promise.resolve(jsonResponse({}, 500)));

		await expect(collect(doajAdapter.crawl({}))).rejects.toThrow(HTTP_500_RE);
	});
});
