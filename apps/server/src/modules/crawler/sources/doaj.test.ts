import { afterEach, describe, expect, it, mock } from "bun:test";
import type { NewPaper } from "@scholar-seek/db/schema/papers";
import { DOAJ_LCC_TERMS } from "../source-taxonomies";
import { doajAdapter } from "./doaj";

const [termA, termB] = DOAJ_LCC_TERMS;
if (!(termA && termB)) {
	throw new Error("DOAJ_LCC_TERMS must have at least two entries for tests");
}

function xmlResponse(
	body: string,
	status = 200,
	headers?: Record<string, string>
) {
	return new Response(body, { status, headers });
}

type FetchFn = (
	input: RequestInfo | URL,
	init?: RequestInit
) => Promise<Response>;

function setFetch(fn: FetchFn) {
	globalThis.fetch = mock(fn) as unknown as typeof fetch;
}

async function collect(
	gen: AsyncGenerator<{ category: string | undefined; papers: NewPaper[] }>
): Promise<NewPaper[]> {
	const out: NewPaper[] = [];
	for await (const { papers } of gen) {
		out.push(...papers);
	}
	return out;
}

async function collectBatches(
	gen: AsyncGenerator<{ category: string | undefined; papers: NewPaper[] }>
): Promise<{ category: string | undefined; papers: NewPaper[] }[]> {
	const out: { category: string | undefined; papers: NewPaper[] }[] = [];
	for await (const batch of gen) {
		out.push(batch);
	}
	return out;
}

function articleXml({
	id = "abc123",
	language = "ind",
	title = "A DOAJ Article",
}: { id?: string; language?: string; title?: string } = {}) {
	return `
<record>
	<header><identifier>oai:doaj.org/article:${id}</identifier></header>
	<metadata>
		<oai_doaj:doajArticle xmlns:oai_doaj="http://doaj.org/features/oai_doaj/1.0/">
			<oai_doaj:language>${language}</oai_doaj:language>
			<oai_doaj:journalTitle>Journal of Openness</oai_doaj:journalTitle>
			<oai_doaj:publicationDate>2019-03-01</oai_doaj:publicationDate>
			<oai_doaj:doi>10.5678/xyz</oai_doaj:doi>
			<oai_doaj:title>${title}</oai_doaj:title>
			<oai_doaj:authors>
				<oai_doaj:author><oai_doaj:name>Jane Doe</oai_doaj:name></oai_doaj:author>
			</oai_doaj:authors>
			<oai_doaj:abstract>  An abstract.  </oai_doaj:abstract>
			<oai_doaj:fullTextUrl format="HTML">https://doaj.org/article/${id}</oai_doaj:fullTextUrl>
			<oai_doaj:keywords>
				<oai_doaj:keyword>openness</oai_doaj:keyword>
			</oai_doaj:keywords>
		</oai_doaj:doajArticle>
	</metadata>
</record>`;
}

const DELETED_RECORD_XML = `
<record>
	<header status="deleted"><identifier>oai:doaj.org/article:deleted1</identifier></header>
</record>`;

function listRecordsXml(records: string, resumptionToken?: string) {
	return `<?xml version="1.0"?>
<OAI-PMH>
	<ListRecords>
		${records}
		${resumptionToken ? `<resumptionToken>${resumptionToken}</resumptionToken>` : ""}
	</ListRecords>
</OAI-PMH>`;
}

function noRecordsMatchXml() {
	return `<?xml version="1.0"?>
<OAI-PMH>
	<error code="noRecordsMatch">no records</error>
</OAI-PMH>`;
}

const HTTP_500_RE = /HTTP 500/;
const RATE_LIMIT_RE = /rate limit/i;

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("doajAdapter.crawl", () => {
	it("maps a valid oai_doaj record into a NewPaper", async () => {
		setFetch(() => Promise.resolve(xmlResponse(listRecordsXml(articleXml()))));

		const papers = await collect(doajAdapter.crawl({}));

		expect(papers).toHaveLength(1);
		const paper = papers[0];
		expect(paper?.title).toBe("A DOAJ Article");
		expect(paper?.abstract).toBe("An abstract.");
		expect(paper?.authors).toEqual(["Jane Doe"]);
		expect(paper?.doi).toBe("10.5678/xyz");
		expect(paper?.source_url).toBe("https://doaj.org/article/abc123");
		expect(paper?.journal).toBe("Journal of Openness");
		expect(paper?.keywords).toEqual(["openness"]);
		expect(paper?.published_at?.toISOString().slice(0, 10)).toBe("2019-03-01");
	});

	it("filters out records not in the ind language scope", async () => {
		setFetch(() =>
			Promise.resolve(
				xmlResponse(listRecordsXml(articleXml({ language: "eng" })))
			)
		);

		const papers = await collect(doajAdapter.crawl({}));

		expect(papers).toHaveLength(0);
	});

	it("filters out deleted records", async () => {
		setFetch(() =>
			Promise.resolve(xmlResponse(listRecordsXml(DELETED_RECORD_XML)))
		);

		const papers = await collect(doajAdapter.crawl({}));

		expect(papers).toHaveLength(0);
	});

	it("returns no records on noRecordsMatch without throwing", async () => {
		setFetch(() => Promise.resolve(xmlResponse(noRecordsMatchXml())));

		const papers = await collect(doajAdapter.crawl({}));

		expect(papers).toHaveLength(0);
	});

	it("follows the resumptionToken to fetch a second page", async () => {
		const fetchMock = mock<FetchFn>();
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				xmlResponse(listRecordsXml(articleXml({ id: "p1" }), "token-page-2"))
			)
		);
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(xmlResponse(listRecordsXml(articleXml({ id: "p2" }))))
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const papers = await collect(doajAdapter.crawl({}));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(papers).toHaveLength(2);
		const secondCallUrl = String(fetchMock.mock.calls[1]?.[0]);
		expect(secondCallUrl).toContain("resumptionToken=token-page-2");
	}, 10_000);

	it("throws on a non-retryable HTTP error", async () => {
		setFetch(() => Promise.resolve(xmlResponse("", 500)));

		await expect(collect(doajAdapter.crawl({}))).rejects.toThrow(HTTP_500_RE);
	});

	it("retries on HTTP 429, then succeeds", async () => {
		const fetchMock = mock<FetchFn>();
		fetchMock.mockImplementationOnce(() => Promise.resolve(xmlResponse("", 429)));
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(xmlResponse(listRecordsXml(articleXml())))
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const papers = await collect(doajAdapter.crawl({}));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(papers).toHaveLength(1);
	});

	it(
		"throws after exceeding max retries on repeated 429s",
		async () => {
			setFetch(() => Promise.resolve(xmlResponse("", 429)));

			await expect(collect(doajAdapter.crawl({}))).rejects.toThrow(
				RATE_LIMIT_RE
			);
		},
		10_000
	);

	it("fans out across multiple LCC terms and yields results from both", async () => {
		const setParam = (setSpec: string) =>
			new URLSearchParams({ set: setSpec }).toString();
		const fetchMock = mock<FetchFn>((url: RequestInfo | URL) => {
			const urlStr = String(url);
			if (urlStr.includes(setParam(termA.setSpec))) {
				return Promise.resolve(
					xmlResponse(listRecordsXml(articleXml({ id: "a1" })))
				);
			}
			if (urlStr.includes(setParam(termB.setSpec))) {
				return Promise.resolve(
					xmlResponse(listRecordsXml(articleXml({ id: "b1" })))
				);
			}
			return Promise.resolve(xmlResponse(noRecordsMatchXml()));
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const batches = await collectBatches(
			doajAdapter.crawl({ categories: [termA.label, termB.label] })
		);
		const papers = batches.flatMap((b) => b.papers);

		expect(papers.map((p) => p.source_id).sort()).toEqual([
			"https://doaj.org/article/a1",
			"https://doaj.org/article/b1",
		]);
		expect(batches.map((b) => b.category).sort()).toEqual(
			[termA.label, termB.label].sort()
		);
	});

	it("throws on an unrecognized LCC label", async () => {
		await expect(
			collect(doajAdapter.crawl({ categories: ["Not a real term"] }))
		).rejects.toThrow(/Unknown DOAJ LCC term/);
	});
});
