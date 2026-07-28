import { afterEach, describe, expect, it, mock } from "bun:test";
import type { NewPaper } from "@scholar-seek/db/schema/papers";
import { arxivAdapter } from "./arxiv";

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

const OK_HEADER =
	"<header><identifier>oai:arXiv.org:2101.00001</identifier></header>";

const VALID_RECORD_XML = `
<record>
	${OK_HEADER}
	<metadata>
		<arXiv>
			<id>2101.00001</id>
			<created>2021-01-05</created>
			<title>A   Great\nPaper</title>
			<abstract>An  abstract\nwith whitespace.</abstract>
			<authors>
				<author><keyname>Lovelace</keyname><forenames>Ada</forenames></author>
				<author>Grace Hopper</author>
			</authors>
			<categories>cs.AI cs.LG</categories>
			<journal-ref>Journal of Testing, 2021</journal-ref>
			<doi type="doi">10.1234/abc</doi>
		</arXiv>
	</metadata>
</record>`;

const DELETED_RECORD_XML = `
<record>
	<header status="deleted"><identifier>oai:arXiv.org:9999.00000</identifier></header>
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

async function collect(gen: AsyncGenerator<NewPaper[]>): Promise<NewPaper[]> {
	const out: NewPaper[] = [];
	for await (const batch of gen) {
		out.push(...batch);
	}
	return out;
}

const RATE_LIMIT_RE = /rate limit/i;

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("arxivAdapter.crawl", () => {
	it("maps a valid record into a NewPaper", async () => {
		setFetch(() =>
			Promise.resolve(xmlResponse(listRecordsXml(VALID_RECORD_XML)))
		);

		const papers = await collect(arxivAdapter.crawl({}));

		expect(papers).toHaveLength(1);
		const paper = papers[0];
		expect(paper?.title).toBe("A Great Paper");
		expect(paper?.abstract).toBe("An abstract with whitespace.");
		expect(paper?.authors).toEqual(["Ada Lovelace", "Grace Hopper"]);
		expect(paper?.keywords).toEqual(["cs.AI", "cs.LG"]);
		expect(paper?.journal).toBe("Journal of Testing, 2021");
		expect(paper?.doi).toBe("10.1234/abc");
		expect(paper?.source).toBe("arxiv");
		expect(paper?.source_id).toBe("2101.00001");
		expect(paper?.source_url).toBe("https://arxiv.org/abs/2101.00001");
		expect(paper?.published_at?.toISOString().slice(0, 10)).toBe("2021-01-05");
	});

	it("filters out deleted records", async () => {
		setFetch(() =>
			Promise.resolve(xmlResponse(listRecordsXml(DELETED_RECORD_XML)))
		);

		const papers = await collect(arxivAdapter.crawl({}));

		expect(papers).toHaveLength(0);
	});

	it("returns no records on noRecordsMatch without throwing", async () => {
		setFetch(() => Promise.resolve(xmlResponse(noRecordsMatchXml())));

		const papers = await collect(arxivAdapter.crawl({}));

		expect(papers).toHaveLength(0);
	});

	it("follows the resumptionToken to fetch a second page", async () => {
		const fetchMock = mock<FetchFn>();
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(
				xmlResponse(listRecordsXml(VALID_RECORD_XML, "token-page-2"))
			)
		);
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(xmlResponse(listRecordsXml(VALID_RECORD_XML)))
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const papers = await collect(arxivAdapter.crawl({}));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(papers).toHaveLength(2);
		const secondCallUrl = String(fetchMock.mock.calls[1]?.[0]);
		expect(secondCallUrl).toContain("resumptionToken=token-page-2");
	}, 10_000);

	it("retries on HTTP 503 honoring Retry-After, then succeeds", async () => {
		const fetchMock = mock<FetchFn>();
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(xmlResponse("", 503, { "Retry-After": "0" }))
		);
		fetchMock.mockImplementationOnce(() =>
			Promise.resolve(xmlResponse(listRecordsXml(VALID_RECORD_XML)))
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const papers = await collect(arxivAdapter.crawl({}));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(papers).toHaveLength(1);
	});

	it("throws after exceeding max retries on repeated 503s", async () => {
		setFetch(() =>
			Promise.resolve(xmlResponse("", 503, { "Retry-After": "0" }))
		);

		await expect(collect(arxivAdapter.crawl({}))).rejects.toThrow(
			RATE_LIMIT_RE
		);
	});
});
