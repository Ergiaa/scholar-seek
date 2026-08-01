import type { NewPaper } from "@scholar-seek/db/schema/papers";

export type { NewPaper } from "@scholar-seek/db/schema/papers";

export interface CrawlOptions {
	categories?: string[]; // arxiv: ["cs", "cs.AI"]; semantic_scholar: ["Computer Science"]
	maxRecords?: number; // safety cap
	query?: string; // search query — required by the semantic_scholar source
	since?: string; // ISO date YYYY-MM-DD
	until?: string; // ISO date YYYY-MM-DD
}

export interface CrawlBatch {
	// Which category produced this batch — undefined when the target ran
	// with no category filter. Adapters that fan out across multiple
	// categories internally (arxiv, doaj) yield one unambiguous category per
	// batch; semantic_scholar yields its one static category for every batch.
	category: string | undefined;
	papers: NewPaper[];
}

export interface SourceAdapter {
	crawl(options: CrawlOptions): AsyncGenerator<CrawlBatch>;
	readonly name: string;
}
