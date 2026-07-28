/**
 * Populates the database with a diverse set of papers by driving the
 * crawler API. The server must be running (bun run dev:server) since the
 * BullMQ worker lives in the server process.
 *
 * Usage:
 *   bun scripts/populate-db.ts <arxiv|semantic-scholar|doaj|both|all> [flags]
 *
 * Flags:
 *   --max <n>      max records per job          (default 2000)
 *   --since <date> ISO date lower bound         (default 2025-01-01)
 *   --until <date> ISO date upper bound         (default none)
 *   --api <url>    server base URL              (default http://localhost:3000)
 *
 * Examples:
 *   bun scripts/populate-db.ts both
 *   bun scripts/populate-db.ts doaj --max 5000
 *   bun scripts/populate-db.ts all --since 2024-01-01 --max 1000
 *   bun scripts/populate-db.ts arxiv --since 2025-06-01 --max 1000
 */

import { parseArgs } from "node:util";

interface CrawlJob {
  categories?: string[];
  label: string;
  query?: string;
  source: "arxiv" | "semantic_scholar" | "doaj";
}

// ArXiv OAI-PMH sets — one job per top-level category.
const ARXIV_SETS = ["cs", "math", "physics", "q-bio", "econ", "stat"];

// DOAJ fields of study — one job per category, always scoped to Indonesian-
// language journals by the adapter. S2 field names used for consistency.
const DOAJ_CATEGORIES = [
  "Computer Science",
  "Mathematics",
  "Physics",
  "Biology",
  "Chemistry",
  "Medicine",
  "Engineering",
  "Environmental Science",
  "Education",
  "Social Sciences",
  "Economics",
  "Agricultural and Food Sciences",
  "Linguistics",
  "Business",
  "Psychology",
];

// Semantic Scholar bulk-search queries — chosen to spread coverage across
// fields of study rather than concentrate on one topic.
const S2_QUERIES: { fieldsOfStudy: string; query: string }[] = [
  // Computer Science
  { query: "large language models", fieldsOfStudy: "Computer Science" },
  { query: "graph neural networks", fieldsOfStudy: "Computer Science" },
  { query: "query expansion information retrieval", fieldsOfStudy: "Computer Science" },
  { query: "multilingual natural language processing", fieldsOfStudy: "Computer Science" },
  { query: "recommender systems", fieldsOfStudy: "Computer Science" },
  { query: "adversarial machine learning", fieldsOfStudy: "Computer Science" },

  // Medicine
  { query: "cancer immunotherapy", fieldsOfStudy: "Medicine" },
  { query: "vaccine development", fieldsOfStudy: "Medicine" },
  { query: "medical image diagnosis deep learning", fieldsOfStudy: "Medicine" },
  { query: "electronic health records predictive analytics", fieldsOfStudy: "Medicine" },

  // Biology
  { query: "CRISPR gene editing", fieldsOfStudy: "Biology" },
  { query: "gut microbiome", fieldsOfStudy: "Biology" },
  { query: "plant disease detection", fieldsOfStudy: "Biology" },

  // Physics
  { query: "quantum computing", fieldsOfStudy: "Physics" },
  { query: "dark matter", fieldsOfStudy: "Physics" },

  // Environmental Science
  { query: "climate change mitigation", fieldsOfStudy: "Environmental Science" },
  { query: "air quality prediction machine learning", fieldsOfStudy: "Environmental Science" },
  { query: "precision agriculture remote sensing", fieldsOfStudy: "Environmental Science" },

  // Engineering
  { query: "renewable energy storage", fieldsOfStudy: "Engineering" },
  { query: "smart grid optimization", fieldsOfStudy: "Engineering" },
  { query: "electric vehicle battery management", fieldsOfStudy: "Engineering" },
  { query: "intrusion detection system IoT", fieldsOfStudy: "Engineering" },

  // Economics
  { query: "behavioral economics", fieldsOfStudy: "Economics" },

  // Psychology
  { query: "cognitive behavioral therapy", fieldsOfStudy: "Psychology" },

  // Sociology
  { query: "social media public opinion analysis", fieldsOfStudy: "Sociology" },

  // Education
  { query: "adaptive learning systems", fieldsOfStudy: "Education" },
  { query: "student performance prediction machine learning", fieldsOfStudy: "Education" },

  // Political Science
  { query: "misinformation detection social media", fieldsOfStudy: "Political Science" },

  // Materials Science
  { query: "solar panel efficiency materials", fieldsOfStudy: "Materials Science" },

  // Agricultural and Food Sciences
  { query: "crop yield prediction machine learning", fieldsOfStudy: "Agricultural and Food Sciences" },

  // Business
  { query: "customer sentiment analysis", fieldsOfStudy: "Business" },
];

const POLL_INTERVAL_MS = 3000;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  args: process.argv.slice(2),
  options: {
    api: { default: "http://localhost:3000", type: "string" },
    max: { default: "2000", type: "string" },
    since: { default: "2025-01-01", type: "string" },
    until: { type: "string" },
  },
});

const mode = positionals[0];
if (
  !(
    mode === "arxiv" ||
    mode === "semantic-scholar" ||
    mode === "doaj" ||
    mode === "both" ||
    mode === "all"
  )
) {
  console.error(
    "Usage: bun scripts/populate-db.ts <arxiv|semantic-scholar|doaj|both|all> [--max n] [--since date] [--api url]"
  );
  process.exit(1);
}

const apiBase = values.api;
const maxRecords = Number(values.max);
const since = values.since;
const until = values.until;

function buildPlan(): CrawlJob[] {
  const jobs: CrawlJob[] = [];

  if (mode === "arxiv" || mode === "both" || mode === "all") {
    for (const set of ARXIV_SETS) {
      jobs.push({
        categories: [set],
        label: `arxiv/${set}`,
        source: "arxiv",
      });
    }
  }

  if (mode === "semantic-scholar" || mode === "both" || mode === "all") {
    for (const { query, fieldsOfStudy } of S2_QUERIES) {
      jobs.push({
        categories: [fieldsOfStudy],
        label: `s2/"${query}"`,
        query,
        source: "semantic_scholar",
      });
    }
  }

  if (mode === "doaj" || mode === "all") {
    for (const category of DOAJ_CATEGORIES) {
      jobs.push({
        categories: [category],
        label: `doaj/${category}`,
        source: "doaj",
      });
    }
  }

  return jobs;
}

interface CrawlStatus {
  errors: string[];
  papersFound: number;
  papersInserted: number;
  papersSkipped: number;
  status: string;
}

async function startJob(job: CrawlJob): Promise<string> {
  const res = await fetch(`${apiBase}/api/crawl/start`, {
    body: JSON.stringify({
      categories: job.categories,
      maxRecords,
      query: job.query,
      since,
      source: job.source,
      until,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`start failed — HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { jobId: string };
  return body.jobId;
}

async function waitForJob(jobId: string): Promise<CrawlStatus> {
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${apiBase}/api/crawl/status/${jobId}`);
    if (!res.ok) {
      throw new Error(`status poll failed — HTTP ${res.status}`);
    }
    const status = (await res.json()) as CrawlStatus;
    if (status.status === "completed" || status.status === "failed") {
      return status;
    }
  }
}

async function checkServer(): Promise<void> {
  try {
    await fetch(`${apiBase}/api/crawl/history?limit=1`);
  } catch {
    console.error(
      `Cannot reach the server at ${apiBase} — start it first with: bun run dev:server`
    );
    process.exit(1);
  }
}

await checkServer();

const plan = buildPlan();
console.log(
  `Populating via ${plan.length} crawl job(s) — mode=${mode}, max ${maxRecords}/job, ${since} to ${until ?? "now"}\n`
);

let totalInserted = 0;
let totalFound = 0;
let failed = 0;

for (const [i, job] of plan.entries()) {
  const label = `[${i + 1}/${plan.length}] ${job.label}`;
  process.stdout.write(`${label} ... `);

  try {
    const jobId = await startJob(job);
    const result = await waitForJob(jobId);
    totalFound += result.papersFound;
    totalInserted += result.papersInserted;

    if (result.status === "failed") {
      failed += 1;
      console.log(`FAILED — ${result.errors.join("; ")}`);
    } else {
      const suffix =
        result.errors.length > 0 ? ` (warnings: ${result.errors.length})` : "";
      console.log(
        `done — found ${result.papersFound}, inserted ${result.papersInserted}${suffix}`
      );
    }
  } catch (err) {
    failed += 1;
    console.log(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(
  `\nTotal: ${totalInserted} inserted (${totalFound} found) across ${plan.length} jobs${failed > 0 ? `, ${failed} failed` : ""}`
);
