export const YEAR_MIN = 2000;
export const YEAR_MAX = new Date().getFullYear();

// Must match FIELDS_OF_STUDY in the server's papers/fields.ts
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

export const SEARCH_IN_OPTIONS = [
	{ value: "all", label: "All fields" },
	{ value: "title", label: "Title" },
	{ value: "abstract", label: "Abstract" },
	{ value: "keywords", label: "Keywords" },
] as const;

export const SOURCE_LABELS: Record<string, string> = {
	arxiv: "arXiv",
	semantic_scholar: "Semantic Scholar",
};
