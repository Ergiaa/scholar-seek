import { papers } from "@scholar-seek/db/schema/papers";
import { or, type SQL, sql } from "drizzle-orm";

/**
 * Canonical fields of study, matching Semantic Scholar's s2FieldsOfStudy
 * categories. Semantic Scholar papers store these names directly in
 * `keywords`; arXiv papers store category codes (e.g. "cs.AI") which are
 * mapped to a field via ARXIV_PREFIX_TO_FIELD.
 */
export const FIELDS_OF_STUDY = [
	"Agricultural and Food Sciences",
	"Art",
	"Biology",
	"Business",
	"Chemistry",
	"Computer Science",
	"Economics",
	"Education",
	"Engineering",
	"Environmental Science",
	"Geography",
	"Geology",
	"History",
	"Law",
	"Linguistics",
	"Materials Science",
	"Mathematics",
	"Medicine",
	"Philosophy",
	"Physics",
	"Political Science",
	"Psychology",
	"Sociology",
] as const;

export type FieldOfStudy = (typeof FIELDS_OF_STUDY)[number];

/** ArXiv top-level category prefixes -> canonical field of study. */
const ARXIV_PREFIX_TO_FIELD: Record<string, FieldOfStudy> = {
	"astro-ph": "Physics",
	"cond-mat": "Physics",
	cs: "Computer Science",
	econ: "Economics",
	eess: "Engineering",
	"gr-qc": "Physics",
	"hep-ex": "Physics",
	"hep-lat": "Physics",
	"hep-ph": "Physics",
	"hep-th": "Physics",
	math: "Mathematics",
	"math-ph": "Physics",
	nlin: "Physics",
	"nucl-ex": "Physics",
	"nucl-th": "Physics",
	physics: "Physics",
	"q-bio": "Biology",
	"q-fin": "Economics",
	"quant-ph": "Physics",
	stat: "Mathematics",
};

const FIELD_TO_ARXIV_PREFIXES = new Map<string, string[]>();
for (const [prefix, field] of Object.entries(ARXIV_PREFIX_TO_FIELD)) {
	const prefixes = FIELD_TO_ARXIV_PREFIXES.get(field) ?? [];
	prefixes.push(prefix);
	FIELD_TO_ARXIV_PREFIXES.set(field, prefixes);
}

export function isFieldOfStudy(value: string): value is FieldOfStudy {
	return (FIELDS_OF_STUDY as readonly string[]).includes(value);
}

/**
 * SQL condition matching papers in the given field: either the keywords
 * array contains the field name directly (Semantic Scholar) or it contains
 * an arXiv category code whose prefix maps to the field.
 */
export function fieldCondition(field: FieldOfStudy): SQL | undefined {
	const conditions: SQL[] = [
		sql`${papers.keywords} @> ${JSON.stringify([field])}::jsonb`,
	];

	for (const prefix of FIELD_TO_ARXIV_PREFIXES.get(field) ?? []) {
		conditions.push(
			sql`EXISTS (
				SELECT 1 FROM jsonb_array_elements_text(${papers.keywords}) AS kw
				WHERE kw = ${prefix} OR kw LIKE ${`${prefix}.%`}
			)`
		);
	}

	return or(...conditions);
}
