# Scholar Seek — System Documentation

## 1. Overview / Pipeline

Scholar Seek is a full-stack academic paper discovery platform. It crawls academic repositories (ArXiv via OAI-PMH, Semantic Scholar Bulk Search API, and DOAJ) on a daily schedule, normalizes each record, and upserts it into PostgreSQL. A React SPA built on TanStack Router queries an Elysia (Bun) REST API, which performs full-text or ML-semantic search over the paper index, computes result facets on-the-fly, and caches responses in Redis. Users can filter results by author, journal, keyword, publication year, source, and field of study, then navigate to a detail page that renders the abstract with LaTeX math via KaTeX.

### Request Flow

```
Browser
  │
  ├─ GET /            → Home page (hero + search bar + topic links)
  ├─ GET /search?...  → Search page (query + filters → results + facets)
  └─ GET /paper/:id   → Paper detail page (abstract, metadata, related papers)
         │
         │ Eden Treaty (type-safe HTTP client, inferred from Elysia App type)
         │
         ▼
Elysia API Server (port 3000, Bun runtime)
  │
  ├─ GET  /api/papers          → searchPapers() or mlSearchPapers()
  ├─ GET  /api/papers/:id      → getPaper()
  ├─ GET  /api/papers/:id/related → getRelatedPapers()
  ├─ GET  /api/journals        → getJournals()
  ├─ POST /api/crawl/start     → startCrawl() → BullMQ queue
  ├─ GET  /api/crawl/status/:jobId → getCrawlStatus()
  └─ GET  /api/crawl/history   → getCrawlHistory()
         │
         ├─ Redis (cache)           ← TTL-keyed JSON blobs (5 min for search, 30 min for paper detail)
         ├─ PostgreSQL (Drizzle ORM) ← papers + crawl_history tables
         └─ FastAPI ML service (port 8000) ← POST /search (ML mode only)

BullMQ Worker (same process as Elysia)
  │
  ├─ arxivAdapter        → ArXiv OAI-PMH endpoint
  ├─ semanticScholarAdapter → S2 Bulk Search API
  └─ doajAdapter         → DOAJ REST API v3
```

---

## 2. Frontend (`apps/web`)

**Stack:** React 19, TanStack Router v1, TailwindCSS v4, shadcn/ui, TanStack Query v5

### Routes

| Route | Component | What it renders | Accepted query params |
|---|---|---|---|
| `/` | `HomeComponent` | Hero section, central search bar, four "Featured Topics" link cards | none (topic cards navigate to `/search?q=...`) |
| `/search` | `SearchPage` | Search bar with mode/field controls, filter sidebar, paginated result list, facet chips | `q`, `searchIn`, `searchMode`, `field`, `page`, `pageSize`, `author`, `journal[]`, `keyword[]`, `source[]`, `yearFrom`, `yearTo`, `sortBy` |
| `/paper/:id` | `PaperPage` | Full paper detail (title, authors, abstract with LaTeX, metadata card, keywords, related papers sidebar); "Back to search" link restores the last search URL | `id` (UUID path param) |

All routes are file-based under `apps/web/src/routes/` and use TanStack Router's `createFileRoute`. The search route validates its query string with a Zod schema (`searchSchema`) at the router level, giving compile-time and run-time type safety on every URL parameter.

### Key Components

| Component | File | Role |
|---|---|---|
| `SearchBar` | `components/search/search-bar.tsx` | Text input + Mode toggle (Standard / ML Search) + "Search in" field selector + Field of Study dropdown. Pressing `/` anywhere on the page focuses the input. Submits via form, calls `onSearch` prop or navigates directly. |
| `FilterPanel` | `components/search/filter-panel.tsx` | Sticky sidebar on desktop, collapsible accordion on mobile. Hosts date-range, author free-text, source facet, journal facet, and keyword facet sub-components. |
| `FacetList` | `components/search/facets/facet-list.tsx` | Reusable checkbox list with optional inline search. Used for journals, keywords, sources. |
| `DateRangeFilter` | `components/search/filters/date-range-filter.tsx` | Dual numeric inputs for `yearFrom`/`yearTo` (clamped to `YEAR_MIN=2000` – current year). |
| `AuthorFilter` | `components/search/filters/author-filter.tsx` | Free-text author name input. |
| `ResultCard` | `components/search/result-card.tsx` | Card showing title (link to `/paper/:id`), abstract preview (2 lines), author badges, journal + date, and external source link. |
| `ArxivAbstract` | `components/paper/arxiv-abstract.tsx` | Tokenizes abstract text into `text` / `inline` (`$...$`) / `display` (`$$...$$`) segments. Renders math via **KaTeX** (`katex.renderToString`), processes common LaTeX text commands (`\textit`, `\textbf`, `\emph`, `---`), and HTML-escapes plain text. Falls back to `<code>` on KaTeX errors. |
| `SearchResults` | `components/search/search-results.tsx` | Composes `FilterProvider`, `FacetsProvider`, `FilterPanel`, result list, pagination, and sort controls. Manages a filter-change debounce so a filter toggle always resets to page 1 before sending the query. |

### State Management

All search state lives in the **URL**. TanStack Router's `useSearch` and `useNavigate` are the only state store — every filter change calls `navigate({ to: '/search', search: { ...existing, ...newParams, page: 1 } })`. This means the back button, bookmarks, and page refresh all work without extra hydration logic.

Filter context (`active-filters.tsx`) is a thin React context that wraps a `useFilters` hook, providing named setters (`setAuthorFilter`, `setJournalFilter`, etc.) that dispatch URL navigations.

Facets are stored in a `FacetsContext` local to the `SearchResults` tree and are populated from each `useSearchPapers` response.

**Session persistence** (`lib/search-state.ts`): `saveSearchState()` writes the current search URL to `sessionStorage` whenever the `/search` URL changes. The paper detail page reads this to restore the "Back to search" link.

**Server state** is managed by TanStack Query (`useQuery`). The `keepPreviousData` option keeps the previous result list visible while a new query is in flight, preventing layout flicker during pagination.

### API Client

`apps/web/src/lib/api/treaty.ts` exports a single `api` object created with `@elysiajs/eden`'s `treaty()`:

```ts
export const api = treaty<App>(SERVER_URL);
```

`App` is the inferred type of the Elysia app exported from the server package. Eden Treaty derives the full request/response type contract from this type, so calling `api.api.papers.get({ query: { q: "..." } })` is fully type-checked end-to-end without any OpenAPI schema generation or separate type definition files.

This is preferred over plain `fetch` because it eliminates an entire class of client-server contract bugs at compile time and removes the need for manual type assertions on response bodies.

---

## 3. Backend (`apps/server`)

**Stack:** Elysia 1.x on Bun, BullMQ, ioredis, Drizzle ORM

The server starts on port 3000. On startup it calls `cleanupStuckJobs()` (marks any `running` crawl history rows as `failed`) then `startCrawlWorker()` to bring up the BullMQ worker.

### Middleware

- **CORS** (`@elysiajs/cors`): origin restricted to `CORS_ORIGIN` env var; methods `GET, POST, OPTIONS`.
- **Rate limiting** (`elysia-rate-limit`): 100 requests / 60 seconds per IP, applied to the `papersModule`. IP extracted from `x-forwarded-for` → `x-real-ip` → server `requestIP()`.
- **Error handling**: Global `.onError()` maps `VALIDATION` → 400, `NOT_FOUND` → 404, everything else → 500.
- **No auth middleware**: all paper and crawler endpoints are currently public.

### `module.papers` — `/api` prefix

| Method | Path | Query / Body | Response | Notes |
|---|---|---|---|---|
| `GET` | `/api/papers` | `q`, `searchIn`, `searchMode`, `field`, `page`, `pageSize`, `sortBy`, `author`, `journal`, `keyword`, `source`, `yearFrom`, `yearTo` | `SearchResult` | `searchMode=ml` proxies to FastAPI; default is `standard` |
| `GET` | `/api/papers/:id` | — | `PaperResponse` | 404 if not found |
| `GET` | `/api/papers/:id/related` | `limit` (default 5) | `PaperResponse[]` | Matches by shared keywords |
| `GET` | `/api/journals` | — | `string[]` | Distinct sorted journal names |

**`searchPapers` (standard mode):**

1. Checks Redis cache (`papers:search:<params-json>`, TTL 300 s).
2. Builds a search condition (free-text `ilike` against title/abstract/authors/keywords/journal based on `searchIn`).
3. Optionally adds a field-of-study condition (`fieldCondition()` in `fields.ts`) — this matches Semantic Scholar field names directly, or maps ArXiv category prefixes (e.g. `cs`, `cs.AI`) to their canonical field.
4. Runs **three parallel queries** to Postgres: paginated result rows, total count (filtered), and facet rows (search-only, no result filters).
5. Computes facets in-memory (journal/keyword/author/year/source counts, sorted by frequency).
6. Returns and caches the result.

**`mlSearchPapers` (ML mode):**

1. Checks Redis cache (`papers:ml:<params-json>`, TTL 120 s).
2. POSTs `{ q, limit: 100, search_in }` to `$ML_SERVICE_URL/search` (default `http://localhost:8000`).
3. Receives `{ results: [{ id, ... }], subqueries: string[] }` — the ML service returns an ordered list of paper IDs by relevance and the query expansions it used.
4. Fetches facet rows and full paper rows from Postgres using `inArray(papers.id, orderedIds)`.
5. Applies field-of-study and result filters in-memory.
6. Restores ML relevance order unless `sortBy` overrides it.
7. Returns paginated results with `subqueries` included in the response (displayed as "Expanded to: …" in the UI).

**`getRelatedPapers`:** loads the source paper's keywords, then fetches up to `limit` other papers that share any of those keywords (JSONB `@>` containment). Returns raw results with no ranking.

**`getJournals`:** returns distinct non-null journal names, cached for 1 hour.

### `module.crawler` — `/api` prefix

| Method | Path | Body / Query | Response |
|---|---|---|---|
| `POST` | `/api/crawl/start` | `source`, `query?`, `since?`, `until?`, `categories?[]`, `maxRecords?` | `{ jobId, historyId, message }` |
| `GET` | `/api/crawl/status/:jobId` | — | `CrawlStatusResponse` or 404 |
| `GET` | `/api/crawl/history` | `limit?` (max 100, default 20) | `CrawlStatusResponse[]` |

`startCrawl()` inserts a `crawl_history` row (status `running`) before enqueuing, so the client can poll immediately. The BullMQ job payload is `{ source, options, historyId }`.

### Redis Cache Helpers (`lib/cache.ts`)

| Function | Behaviour |
|---|---|
| `cacheGet<T>(key)` | `GET key` → JSON.parse, returns `null` on miss |
| `cacheSet<T>(key, value, ttlSeconds)` | `SET key JSON EX ttl` |
| `cacheDel(pattern)` | `KEYS pattern` → `DEL ...keys` (glob patterns) |

**Cache key strategy:**

| Key pattern | TTL | Invalidated by |
|---|---|---|
| `papers:search:<json>` | 300 s | Crawl job completion (`cacheDel("papers:*")`) |
| `papers:ml:<json>` | 120 s | Crawl job completion |
| `papers:id:<uuid>` | 1800 s | Crawl job completion |
| `journals:all` | 3600 s | Crawl job completion (`cacheDel("journals:*")`) |

---

## 4. Database (`packages/db`)

**Stack:** PostgreSQL, Drizzle ORM, `pg` driver. Managed via `drizzle-kit` commands.

### Schema

#### `papers` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `title` | `text NOT NULL` | |
| `abstract` | `text` | nullable |
| `authors` | `jsonb NOT NULL` | `string[]`, default `[]` |
| `published_at` | `timestamptz` | nullable |
| `journal` | `varchar(255)` | nullable |
| `doi` | `varchar(255) UNIQUE` | nullable |
| `keywords` | `jsonb` | `string[]` nullable — ArXiv categories (e.g. `cs.LG`) or S2 field names |
| `source_url` | `text NOT NULL` | canonical link to original paper |
| `source` | `varchar(100)` | `arxiv` \| `semantic_scholar` \| `doaj` |
| `source_id` | `varchar(255)` | ArXiv ID, S2 `paperId`, or DOAJ article ID |
| `citation_count` | `integer NOT NULL` | default 0; only Semantic Scholar enriches this |
| `embedding_stored` | `boolean NOT NULL` | flag for ML service to track which papers have embeddings |
| `created_at` | `timestamptz NOT NULL` | `now()` |

**Unique constraint:** `(source, source_id)` — prevents duplicate records per source; upsert target for crawl jobs.

**Indexes:** btree on `journal`, `published_at`, `source`, `embedding_stored`; GIN on `authors` and `keywords` (for JSONB containment queries).

#### `crawl_history` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `job_id` | `varchar(255) NOT NULL` | BullMQ job ID |
| `source` | `varchar(100) NOT NULL` | |
| `status` | `varchar(50) NOT NULL` | `running` \| `completed` \| `failed` |
| `started_at` | `timestamptz NOT NULL` | `now()` |
| `completed_at` | `timestamptz` | nullable |
| `papers_found` | `integer NOT NULL` | total records yielded by adapter |
| `papers_inserted` | `integer NOT NULL` | rows returned by upsert |
| `papers_skipped` | `integer NOT NULL` | batch failures or conflicts |
| `errors` | `jsonb` | `string[]` nullable |
| `duration_ms` | `integer` | nullable |
| `options` | `jsonb` | crawl options snapshot (`since`, `until`, `categories`, `maxRecords`) |

**Indexes:** btree on `source`, `started_at`, `status`.

### Migration History

| Migration | Description |
|---|---|
| `0000_majestic_blink.sql` | Initial schema: `papers` + `crawl_history` tables + btree indexes |
| `0001_aberrant_vin_gonzales.sql` | Added GIN indexes on `papers.authors` and `papers.keywords` |
| `0002_broken_psynapse.sql` | Added unique btree index on `(source, source_id)` |

Schema is still actively evolving. Three migrations to date.

### Seed Data

`packages/db/src/seed.ts` — run via `bun run db:seed`. Useful for seeding a local development database with sample papers for UI development without running a full crawl.

### Infrastructure

`packages/db/docker-compose.yml` spins up `postgres` (image: `postgres`, port 5432) and `redis:7-alpine` (port 6379) with named volumes for data persistence.

> **pgvector / HNSW:** The `embedding_stored` flag in the schema anticipates vector search integration. As of this writing, there is no `manual_pgvector_setup.sql` in the repository — the pgvector extension and HNSW index are managed by the external ML service.

---

## 5. Crawler / Ingestion Detail

The crawler module uses a **SourceAdapter** interface: each adapter is an object with a `name` and an `async *crawl(options)` generator that yields `NewPaper[]` batches.

```ts
interface SourceAdapter {
  name: string;
  crawl(options: CrawlOptions): AsyncGenerator<NewPaper[]>;
}

interface CrawlOptions {
  query?: string;      // required for semantic_scholar
  since?: string;      // YYYY-MM-DD
  until?: string;      // YYYY-MM-DD
  categories?: string[];
  maxRecords?: number;
}
```

### ArXiv Adapter (`sources/arxiv.ts`)

- **Endpoint:** `https://export.arxiv.org/oai2` with `verb=ListRecords&metadataPrefix=arXiv`
- **Date scoping:** `from` / `until` OAI-PMH parameters; maps to `since` / `until` in `CrawlOptions`.
- **Category scoping:** OAI-PMH only supports top-level sets (`cs`, `math`). Subcategories (e.g. `cs.LG`) are stripped to the prefix for the API call, then post-filtered in-memory.
- **Pagination:** OAI-PMH `resumptionToken` — each page yields ~1000 records. The adapter follows tokens until exhausted or `maxRecords` is reached.
- **Rate limiting:** 3-second delay between pages; respects `503 Retry-After` headers.
- **Retries:** up to 3 retries with linear backoff.
- **Field mapping:** ArXiv OAI `arXiv` metadata → `papers` row. Categories stored as `keywords` (e.g. `["cs.LG", "cs.AI"]`). `journal-ref` tag → `journal`. `source` = `"arxiv"`, `source_id` = ArXiv ID.
- **XML parsing:** `fast-xml-parser` with entity expansion limit raised to 100,000 to handle long abstracts.

### Semantic Scholar Adapter (`sources/semantic-scholar.ts`)

- **Endpoint:** `https://api.semanticscholar.org/graph/v1/paper/search/bulk`
- **Fields fetched:** `title,abstract,authors,year,publicationDate,venue,journal,externalIds,citationCount,s2FieldsOfStudy`
- **Pagination:** cursor-based `token` field in response.
- **Rate limiting:** 1,100 ms between pages. Optional `S2_API_KEY` env var enables a dedicated 1 req/s rate limit (vs. shared unauthenticated pool).
- **Deduplication identity:** if a paper has an `externalIds.ArXiv` ID, it is stored with `source = "arxiv"` and `source_id = arxivId` — so it merges with ArXiv OAI records on upsert rather than creating a duplicate. This is how Semantic Scholar enriches ArXiv papers with citation counts.
- **Keywords:** `s2FieldsOfStudy[].category` strings (e.g. `"Computer Science"`, `"Mathematics"`).

### DOAJ Adapter (`sources/doaj.ts`)

- **Endpoint:** `https://doaj.org/api/v3/search/articles/<query>?pageSize=100&page=N`
- **Scope:** always restricted to Indonesian-language journals (`bibjson.journal.language:id`), making this the source most relevant to the thesis context.
- **Category mapping:** Semantic Scholar field names translated to DOAJ LCC subject terms via `S2_TO_LCC` lookup table.
- **Pagination:** offset-based page numbers.
- **Keywords:** union of `bibjson.keywords` and `bibjson.subject[].term`.

### Upsert Logic (`queue.ts → processJob`)

For each batch yielded by an adapter, the worker runs:

```sql
INSERT INTO papers (...) VALUES (...)
ON CONFLICT (source, source_id) DO UPDATE SET
  title = excluded.title,
  abstract = COALESCE(excluded.abstract, papers.abstract),
  keywords = COALESCE(excluded.keywords, papers.keywords),
  published_at = COALESCE(excluded.published_at, papers.published_at),
  journal = COALESCE(excluded.journal, papers.journal),
  doi = COALESCE(excluded.doi, papers.doi),
  citation_count = GREATEST(papers.citation_count, excluded.citation_count)
```

`COALESCE` ensures a source that lacks a field cannot null out data already provided by another source. `GREATEST` ensures citation counts only ever increase.

### Daily Schedule

In production (`NODE_ENV=production`), `startCrawlWorker()` registers a repeatable BullMQ job:

```
name: "daily-arxiv-trigger"
cron: "0 2 * * *"   (02:00 UTC daily)
source: "arxiv"
historyId: "__auto__"
```

When the worker picks up an `__auto__` job, it calls `createAutoHistoryRecord()` which reads the last successful crawl's `completed_at` date from `crawl_history` and uses it as the `since` parameter, so each daily run only fetches new/updated records since the previous run.

After each successful `processJob()`, the worker calls `cacheDel("papers:*")` and `cacheDel("journals:*")` to invalidate all search and journal caches so users see fresh data.

> The crawler does **not** call any `/internal/reload-index` endpoint on the Elysia server. Index reloading for the ML service is handled by the FastAPI service independently (e.g. by watching the `embedding_stored` flag on the `papers` table).

---

## 6. Integration Point — Website ↔ ML Service

### Contract

The Elysia server communicates with the ML service exclusively via one endpoint:

**Request** (from Elysia `mlSearchPapers`):

```
POST $ML_SERVICE_URL/search
Content-Type: application/json

{
  "q": "large language models",
  "limit": 100,
  "search_in": "all"        // "all" | "title" | "abstract" | "keywords"
}
```

**Response** (from FastAPI):

```json
{
  "results": [
    {
      "id": "<uuid>",
      "title": "...",
      "abstract": "...",
      "authors": ["..."],
      "journal": "...",
      "published_at": "...",
      "doi": "...",
      "source_url": "...",
      "keywords": ["..."]
    }
  ],
  "subqueries": ["large language models", "LLMs", "transformer architectures"]
}
```

The ML service returns papers **ordered by relevance** (BM25 + dense embeddings). Elysia uses only the `id` field from each result for database lookup; all displayed paper data is re-fetched from Postgres.

### Error Handling

If the ML service returns a non-2xx status, `mlSearchPapers` throws an `Error` with the status code and response body. This propagates up through the Elysia error handler and returns a `500` response to the frontend.

In the UI, `useSearchPapers` catches query errors and renders: "Error loading results. Please try again."

The UI does **not** automatically fall back from ML mode to standard mode on ML service failure — the error state is shown as-is.

### Request Transformation

`mlSearchPapers` forwards the `searchIn` parameter to the ML service as `search_in`. All other query parameters (`field`, `author`, `journal`, `keyword`, `source`, `yearFrom`, `yearTo`, `sortBy`) are applied by Elysia against Postgres after receiving the ML response — the ML service only handles semantic ranking.

---

## 7. Testing

There are currently **no automated tests** in `apps/web` or `apps/server`. No `tests/` directory exists at any level of the monorepo.

**Manual QA process followed:**

- Crawling: triggered via `POST /api/crawl/start` with various `source`, `since`, `categories`, and `maxRecords` combinations; progress monitored via `GET /api/crawl/history`.
- Search: exercised standard and ML modes with queries in different fields, verified filter interactions, pagination, and sort orders in browser.
- Paper detail: verified LaTeX rendering with known math-heavy abstracts from cs.LG.
- Edge cases tested: empty search, no-results state, ML service down, very long author lists, papers without abstracts.

---

## 8. What's New Since Last Review

The following features were added in recent work (relative to the initial ArXiv-only crawler commit `c4fbd14`):

### New Data Sources
- **Semantic Scholar adapter** (`sources/semantic-scholar.ts`): bulk search API with cursor pagination, citation count enrichment, and identity merging with ArXiv records.
- **DOAJ adapter** (`sources/doaj.ts`): Indonesian-language journal articles via DOAJ API v3, with S2-to-LCC subject mapping.

### New Backend Features
- **ML search mode** (`mlSearchPapers`): proxies to a FastAPI semantic search service, returns ML-ranked results with query expansion terms (`subqueries`).
- **Field-of-study filter** (`fields.ts`): `fieldCondition()` maps 23 canonical fields to both Semantic Scholar keywords and ArXiv category prefixes, works in both standard and ML modes.
- **Source filter**: facet and filter on which repository a paper came from (`arxiv` / `semantic_scholar` / `doaj`).
- **Source facet** in `SearchResult.facets.sources`.
- **`sourceFacet` field** added to the facets response.

### New Frontend Features
- **ML Search mode toggle** in `SearchBar` — switches between Standard (keyword `ilike`) and ML (semantic) search.
- **"Expanded to:" chip** in search results showing ML service's `subqueries`.
- **Source filter chip** in `FilterPanel` and `ActiveFiltersDisplay`.
- **Field of study dropdown** in `SearchBar` (23 fields).
- **LaTeX rendering** in `ArxivAbstract` and `ResultCard` previews — KaTeX for `$...$` and `$$...$$` expressions, with `\textit`/`\textbf`/`\emph` and em/en-dash processing for plain text.
- **Page size selector** (10 / 20 / 50 results per page).
- **Sort dropdown** (Relevance / Newest / Oldest / Title A–Z / First Author A–Z).
- **Active filter chips** above result list with individual remove buttons.
- **"Back to search" link** on paper detail page that restores the full previous search URL including filters.

### Schema Changes
- Migration `0001`: GIN indexes on `authors` and `keywords` for faster JSONB containment queries.
- Migration `0002`: Unique index on `(source, source_id)` to enable upsert-based deduplication across all three sources.

### Scripts Added
- `scripts/check-s2-graph.ts`, `scripts/check-s2-snapshot.ts`: diagnostic scripts for Semantic Scholar API exploration.
- `scripts/populate-db.ts`: bulk population helper.
- `apps/server/src/modules/papers/fields.ts`: field-of-study mapping logic (extracted from service layer).
