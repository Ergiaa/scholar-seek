import type { NewPaper } from "@scholar-seek/db/schema/papers";

export type { NewPaper } from "@scholar-seek/db/schema/papers";

export interface CrawlOptions {
	categories?: string[]; // arxiv: ["cs", "cs.AI"]; semantic_scholar: ["Computer Science"]
	maxRecords?: number; // safety cap
	query?: string; // search query — required by the semantic_scholar source
	since?: string; // ISO date YYYY-MM-DD
	until?: string; // ISO date YYYY-MM-DD
}

export interface SourceAdapter {
	crawl(options: CrawlOptions): AsyncGenerator<NewPaper[]>;
	readonly name: string;
}
