import { sleep } from "bun";

/**
 * One full harvest within a target's crawl() call — e.g. one arXiv top-level
 * group or one DOAJ LCC term. A target selecting multiple categories that
 * don't fit in a single OAI-PMH `set` fans out into several of these, run
 * sequentially, sharing one cumulative `maxRecords` budget.
 */
export interface HarvestUnit<T> {
	// The canonical-mapping-facing category label for every paper this unit
	// yields (e.g. arXiv's top-level group, or a DOAJ LCC term). `undefined`
	// means "no category filter was requested" (whole-source harvest).
	category: string | undefined;
	buildInitialUrl: () => string;
	buildResumeUrl: (resumptionToken: string) => string;
	// Post-fetch subcode filter (arXiv only) — applied after fetching this
	// unit's full `set`, before the cumulative cap is applied.
	filterRecords?: (records: T[]) => T[];
}

export interface OaiPage<T> {
	records: T[];
	resumptionToken?: string;
}

/**
 * Runs each unit's resumption-token pagination loop in sequence, yielding
 * `{ category, papers }` batches, and stops once the running total across
 * every unit hits `maxRecords` — the cap is cumulative for the whole target,
 * never reset per unit.
 */
export async function* harvestUnitsSequentially<T>(
	units: HarvestUnit<T>[],
	fetchPage: (url: string) => Promise<OaiPage<T>>,
	maxRecords: number,
	batchSize: number,
	delayMs: number
): AsyncGenerator<{ category: string | undefined; papers: T[] }> {
	let totalYielded = 0;

	for (const unit of units) {
		if (totalYielded >= maxRecords) {
			break;
		}

		let url = unit.buildInitialUrl();

		while (true) {
			const { records, resumptionToken } = await fetchPage(url);
			const filtered = unit.filterRecords
				? unit.filterRecords(records)
				: records;

			if (filtered.length > 0) {
				const batch = filtered.slice(0, maxRecords - totalYielded);
				for (let i = 0; i < batch.length; i += batchSize) {
					yield { category: unit.category, papers: batch.slice(i, i + batchSize) };
				}
				totalYielded += batch.length;
			}

			if (!resumptionToken || totalYielded >= maxRecords) {
				break;
			}

			url = unit.buildResumeUrl(resumptionToken);
			await sleep(delayMs);
		}
	}
}
