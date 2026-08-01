# Admin Dashboard — Technical Requirements (dev notes)

Working notes for implementation once the UX spec is signed off. Not a committed doc — reference only.

## 1. Schema migration: source moves from schedule to target

- Drop `crawl_schedule.source`.
- Add `crawl_schedule_target.source` (`arxiv | semantic_scholar | doaj`), NOT NULL.
- Add `crawl_history.target_id` (FK → `crawl_schedule_target.id`, nullable, `onDelete: set null`) — needed so "since" (last successful run) is computed per-target, not per-schedule. Two targets in the same schedule (even same source, different category) must not share a watermark.
- Migration path for the 3 existing seeded schedules: each schedule's single target inherits the schedule's current `source` value; no data loss, straightforward backfill.
- `estimateTotalRequests` unaffected (source-agnostic, just sums `ceil(maxRecords/100)`).

## 2. Backend logic changes

- `validateTargetsForSource`: currently validates the whole schedule against one source. Change to per-target: for each target, if `target.source === "semantic_scholar"` and no query → reject with that target's label in the message.
- `runSchedule` (queue.ts): read `target.source` per target instead of `schedule.source` when building `CrawlOptions` and inserting `crawl_history` rows. Also write `target_id` onto each `crawl_history` insert.
- `getLastSuccessfulCrawlDateForSchedule` → rename/rework to `getLastSuccessfulCrawlDateForTarget(targetId)`, filtering `crawl_history` by `target_id` instead of `schedule_id`.
- `estimateRun`'s `sharedPoolWarning`: becomes "any target.source === semantic_scholar and no S2_API_KEY", not a schedule-level check.
- Schedule list/response shape: drop `schedule.source`; each target in the response carries its own `source`. Frontend needs a derived "sources present" set for badge display (e.g. dedupe `targets.map(t => t.source)`).
- `CreateScheduleBody`/`UpdateScheduleBody` (model.ts): `source` moves from schedule-level into each `ScheduleTargetBody` entry.

## 3. Category taxonomies needed for multi-select

Confirmed against the real, authoritative source for each — not guessed, not the abbreviated lists `populate-db.ts` happened to hardcode.

- **Semantic Scholar**: `FIELDS_OF_STUDY` in `apps/server/src/modules/papers/fields.ts` (~24 entries) — this already *is* our canonical vocabulary, nothing to map.
- **arXiv**: pulled the complete real taxonomy from `arxiv.org/category_taxonomy` — **155 codes across 8 top-level groups** (cs, econ, eess, math, physics [12 sub-groups: astro-ph, cond-mat, gr-qc, hep-ex/lat/ph/th, math-ph, nlin, nucl-ex/th, physics, quant-ph], q-bio, q-fin, stat). Full list saved in this session's scratchpad if needed again. The adapter (`arxiv.ts`) already accepts both top-level codes (drives the actual OAI-PMH `set` fetch) and full subcategory codes (used for post-fetch filtering) — so both granularities are already supported mechanically, this is purely a "what do we expose in the UI" decision, not an adapter change.
- **DOAJ**: real taxonomy is Library of Congress Classification (LCC) subject terms, retrieved directly from `doaj.org/oai?verb=ListSets` (the journal-feed endpoint's `ListSets` — same set list is shared by the article feed, see §3.1) — **538 distinct terms**, one OAI-PMH set per term, no pagination needed (fits in one response). These are the exact same strings the existing `S2_TO_LCC` map in `doaj.ts` already targets (e.g. `"Computer science"`), so the current 24-entry map is a small, verified-correct subset of the full 538 — not wrong, just partial. Full 538-term list saved in this session's scratchpad (`doaj-lcc-terms.txt`) for whenever the mapping gets expanded.
- **Important**: the taxonomy module must store each DOAJ category's `setSpec` token alongside its display label, not just the label. `set=` in an OAI-PMH harvest request takes the literal `setSpec` (an opaque base64url-ish string from `ListSets`, e.g. `TENDOkFjY291bnRpbmcuIEJvb2trZWVwaW5n` for `"Accounting. Bookkeeping"`), not the human-readable term — it isn't derivable from the label, so both must be captured together at the point `ListSets` is read.
- Granularity mismatch across sources (arXiv 155 / DOAJ 538 / Semantic Scholar ~24) is real, but see §3.2 — resolved by not forcing one vocabulary to serve two different jobs, rather than by picking a granularity.
- These lists should live in one shared server-side module (e.g. `apps/server/src/modules/crawler/source-taxonomies.ts`) exported to the frontend via a lightweight endpoint (`GET /api/crawl/taxonomies`) rather than duplicated in the frontend bundle.

## 3.1. DOAJ retrieval — decided: switch from REST to OAI-PMH article feed

**Decision**: replace `doaj.ts`'s REST Articles Search API call with DOAJ's **article-level** OAI-PMH feed. This was initially ruled out after testing the wrong endpoint (`doaj.org/oai`, which is journal-only) — the real article feed lives at a separate base URL, `doaj.org/oai.article`, confirmed live:

```
curl "https://doaj.org/oai.article?verb=Identify"                         → repository metadata, no auth needed
curl "https://doaj.org/oai.article?verb=ListMetadataFormats"              → oai_dc AND oai_doaj both supported
curl "https://doaj.org/oai.article?verb=ListRecords&metadataPrefix=oai_doaj&set=<setSpec>"
  → real article: title, authors+affiliations, abstract, DOI, journal title,
    volume/issue, publicationDate, language, resumptionToken (completeListSize=37799 for one set alone)
```

**Why this is better than the current REST adapter, not just an alternative:**

| | REST Articles Search (current) | OAI-PMH `oai.article` (target) |
|---|---|---|
| Category filtering | String-match `bibjson.subject.term:"..."` inside a hand-built Lucene query | Native `set` param — the LCC term *is* the set |
| Pagination | `page`/`pageSize` | Resumption tokens — **identical pattern already implemented in `arxiv.ts`** (see below) |
| Metadata (`oai_doaj` format) | title, abstract, authors, journal, DOI, keywords, fulltext link, year/month only | Adds: exact `publicationDate` (not year+month guess), volume, issue, start/end page, ORCID-tagged authors with affiliation names, publisher record ID |
| Free-text query | Supported | Not supported — irrelevant here since DOAJ targets never use `query` (only Semantic Scholar requires one) |
| Auth | None | None for the base tier (Premium only affects feed freshness, not access) |

**Implementation plan — mirror `arxiv.ts`'s existing OAI-PMH client, don't invent a new one:**
- Base URL: `https://doaj.org/oai.article` (vs. arXiv's `https://export.arxiv.org/oai2`).
- `metadataPrefix=oai_doaj` (the richer format; `oai_dc` also works but is strictly a subset).
- Same `fast-xml-parser` setup as `arxiv.ts` (`XMLParser` with `isArray` for repeated elements — here that's `author`, `keyword`, `affiliationName`, `record`, `setSpec`).
- Same two-branch `buildUrl`: first request carries `verb=ListRecords&metadataPrefix=oai_doaj&set=<setSpec>&from=<since>&until=<until>`; subsequent pages carry only `verb=ListRecords&resumptionToken=<token>`, exactly like `arxiv.ts:61-88`.
- Same retry/backoff shape as the current `doaj.ts` (`REQUEST_DELAY_MS`, `MAX_RETRIES`, retry-on-429) — DOAJ's OAI-PMH docs don't publish a different rate limit, no reason to assume one.
- **Two things to get right that are easy to get wrong:**
  1. `oai_doaj:language` is a **single** value (only the journal's first listed language), in **three-letter** codes (`spa`, `ger`, `eng` — ISO 639-2), unlike the REST version's `bibjson.journal.language` which is an array of two-letter codes (`id`, `en` — ISO 639-1). If the Indonesian-only scoping (`bibjson.journal.language:id` in the current query) needs to carry over, it becomes a post-fetch filter on `language === "ind"`, not a query clause — and `ind`, not `id`, is the code to match.
  2. The taxonomy module must persist each category's `setSpec` (opaque token) — see §3 above.
- New fields available but not currently in the `papers` schema (volume, issue, page range, ORCID, affiliations) — no schema change forced by this switch; just extra data the adapter can discard for now, same as it discards fields today.

## 3.2. Category granularity — decided: split by purpose, not by picking one width

**Decision (2026-08-01)**: admin-facing (scheduling) and search-facing (end-user filtering) don't need the same vocabulary, so stop trying to force one. Each paper stores **both** its raw source category and a mapped canonical category — neither purpose has to compromise for the other's sake.

- **Admin/scheduling** — the target-category picker shows each source's real native taxonomy at full precision: arXiv's 155 codes, DOAJ's 538 LCC terms, Semantic Scholar's ~24 fields. This is what actually controls what the source API fetches, so precision here is correct, not excessive — no mapping involved at all.
- **Search-facing** — papers are faceted/filtered by a single shared vocabulary, `FIELDS_OF_STUDY` (already exists, already canonical for Semantic Scholar). arXiv and DOAJ categories get mapped down to it **at ingestion time**, not at query time — denormalized for facet performance, matching how the codebase already denormalizes other derived fields (`citation_count`, `embedding_stored`).
- **Schema**: new column on `papers`, e.g. `canonical_categories: string[]`, alongside the existing `keywords` column (which keeps holding the raw, source-reported terms exactly as it does today — nothing about the existing column changes).
- **Where the mapping runs**: one shared step in `processJob` (`queue.ts`), applied uniformly regardless of source, not duplicated per-adapter. Adapters stay responsible only for source-specific parsing. **This requires the adapter interface change specified in §3.3** — `processJob` can only attribute a canonical category per batch if the adapter tells it which category produced that batch, which matters once §3.3's fan-out means a single target's `crawl()` call can span multiple categories internally.
- **Per-source mapping cost is very uneven**:
  - Semantic Scholar → identity, free.
  - arXiv → cheap: map at the **8-group** level (`cs.*` → "Computer Science", `astro-ph.*`/`cond-mat.*`/`hep-*`/... → "Physics", etc.), not per-code. One small table covers all 155 codes.
  - DOAJ → the real work — see below.
- **Important mechanical constraint found**: the `oai_doaj` metadata format (the one §3.1 switches to) has **no subject/category field at all** — only `oai_dc` carries the LCC term per-record. So DOAJ's canonical category can't be read off the fetched record; it has to come from **which target/set harvested it**. This is already available for free — `runSchedule` already knows which target (and its category) produced each job — so this isn't a gap, just a note on where the mapped-category value comes from for this one source.
- **Decided**: all 538 DOAJ LCC terms should eventually be mapped to canonical categories — no permanent "Other/Uncategorized" bucket as the end state, full coverage is the goal. This is a real curation task (538 one-time judgment calls), **tracked separately from this spec, not blocking the rest of the schema/UI work**. The full term list is already saved (`doaj-lcc-terms.txt` in this session's scratchpad) for whenever that mapping work happens. Until it's done, terms without an entry can fall back to "Uncategorized" as an interim state, not a permanent design choice.

## 3.3. Multi-category targets — decided: adapters fan out (arXiv + DOAJ)

**Decision (2026-08-01)**: when a target selects multiple categories that don't fit in
one OAI-PMH `set` request, the adapter issues multiple harvests and merges them,
sharing one cumulative `maxRecords` budget across the whole target. The UI does not
constrain category selection to avoid this — the multi-select stays a genuine
multi-select for every source.

**Why this needed a decision at all**: found while re-checking `arxiv.ts` before
writing the implementation plans. Its current `buildUrl` only ever uses
`options.categories[0]`'s top-level prefix to pick the OAI-PMH `set`; every other
selected category is used only as a *post-fetch filter* against whatever that one set
returned. Concretely: a target with `["cs.LG", "astro-ph.GA"]` fetches only the `cs`
set, then filters for both codes — but no paper in the `cs` set will ever match
`astro-ph.GA`, so those results silently never appear. This is a pre-existing latent
bug, not something introduced by this plan, but the new full-taxonomy multi-select
(§3) makes it trivial for an admin to trigger by accident. DOAJ has the identical
constraint at the protocol level (OAI-PMH `set` is single-valued per request,
confirmed live) once §3.1's OAI-PMH switch lands, so it needed the same fix in the
same pass. Semantic Scholar is unaffected — confirmed its REST API accepts
`fieldsOfStudy` as one comma-separated list in a single request; no fan-out needed
there, ever.

**Implementation shape:**

- **arXiv**: group `target.categories` by top-level prefix (`cs.LG`, `cs.AI` → group
  `cs`; `astro-ph.GA` → group `astro-ph`). For each distinct group present, run one
  full harvest (its own resumption-token loop), post-filtering within that group's
  results by whichever subcodes were requested for it — same post-filter logic that
  already exists, just scoped per-group instead of applied blindly to one fetch. A
  bare top-level category (no subcode, e.g. just `"cs"`) means "no subfilter, take the
  whole group."
- **DOAJ**: no top-level/subcode structure to exploit (each LCC term is its own flat
  `setSpec`, no hierarchy) — every selected category is its own full harvest, no
  exceptions.
- **Both**: iterate groups/categories **sequentially**, not concurrently — the worker
  already runs at concurrency 1, so there's no throughput benefit to interleaving, and
  sequential keeps each source's existing rate-limit pacing (`REQUEST_DELAY_MS`)
  correct without extra coordination.
- **`maxRecords` is a cumulative cap for the whole target, not per sub-harvest.** Once
  the running total across all groups/categories hits `maxRecords`, stop — don't reset
  the counter per group. This is the important part for consistency: it means
  `estimateTotalRequests` (`ceil(maxRecords / 100)`) **doesn't need to change** — the
  worst-case request count to exhaust a target's budget is the same regardless of how
  many groups/categories that budget is spread across. No guardrail/estimate math
  needs touching for this decision.
- **DOAJ canonical-category mapping (§3.2) is simplified by this, not complicated by
  it**: since each sub-harvest is now scoped to exactly one known LCC term, every paper
  yielded during a given sub-harvest has an unambiguous category — whichever term that
  iteration is currently harvesting. No merging ambiguity to resolve.
- **Adapter interface change this forces** (found while reconciling this section with
  §3.2 — the two were decided far enough apart that they didn't obviously connect):
  `SourceAdapter.crawl()` currently yields plain `NewPaper[]`
  (`sources/types.ts:14`). Once fan-out lives inside the adapter's generator, `processJob`
  has no way to know which category produced a given batch — that information only
  exists inside the adapter's loop. Change the yield shape to
  `AsyncGenerator<{ category: string | undefined; papers: NewPaper[] }>` for **all
  three** adapters, not just the two that fan out — Semantic Scholar just yields one
  static category for every batch (its whole `crawl()` call is already one category),
  keeping `processJob`'s consumption uniform across sources rather than branching by
  source to figure out where the category comes from. `processJob`'s canonical-category
  step (§3.2) reads `category` off each yielded batch directly; it never needs to infer
  it from the target another way.
- **Target-to-`crawl_history`-row cardinality is unchanged: still 1:1.** Fan-out is
  entirely internal to one `crawl()` call — the adapter's generator yields a continuous
  stream of batches regardless of how many underlying HTTP requests produced them, and
  `processJob` keeps writing to the one `crawl_history` row it already created for that
  target, the same as today. Nothing about run tracking, `crawl_schedule_run`, or the
  worker's per-target job model needs to change for fan-out — it's contained entirely
  inside the adapter.
- **Worth doing while touching both adapters**: `arxiv.ts` and `doaj.ts` will now share
  near-identical structure (loop over N sets, each with its own resumption-token
  pagination, shared cumulative cap). Consider extracting that shared loop into a small
  helper (e.g. `apps/server/src/modules/crawler/sources/oai-pmh.ts`) both adapters call
  into, rather than duplicating it — not mandatory, but the DRY opportunity is real and
  the two implementations will otherwise drift.

## 4. UI implementation architecture (confirmed, 2026-08-01)

Rule of thumb: **transient/action-triggered → modal/drawer; different data states of the same view → conditional render in place, never a route change.**

- Empty / loading / fresh-install / 0%-coverage states — same page, conditionally rendered based on query state (React Query `isLoading`/`data` checks), not separate routes or popups.
- History row detail — expand-in-place under the row (not a side panel, per this decision — supersedes the "expand or side panel" either/or in the original UX spec).
- Run-now flow (estimate → confirm tiers → progress) — a modal/dialog anchored to the schedule that triggered it. No `packages/ui` dialog/modal primitive exists yet — needs building (base-ui likely has an underlying primitive to wrap, same pattern as `dropdown-menu`).
- Sessions panel — drawer/modal from the user row's "Sessions" action.
- Ban/remove confirmation — standard modal dialog.

## 5. Frontend component gaps

- No multi-select component exists in `packages/ui` (only `checkbox`, `dropdown-menu`, single-value `input`). Need to build one — likely a checkbox-list rendered inside the existing `dropdown-menu` primitive (base-ui), styled to match. Not a new dependency unless the existing primitives can't support it cleanly.
- No modal/dialog primitive exists either (see §4) — needed for the run-now flow, sessions panel, and ban/remove confirmation alike. One primitive, reused three ways.
- Per-target conditional rendering (query field only for `semantic_scholar`) needs the target-row component to switch its own field set based on that row's local `source` state — already close to how the current single-schedule-source form works, just moved one level down.

## 6. Crawl history — decided: server-side filtering and pagination, no client-side filtering

**Decision (2026-08-01)**: `GET /api/crawl/history` (currently just `?limit=`) gets real
query params and real pagination. Client-side filtering of one fetched page was
explicitly rejected — schedules running daily for months will produce a table that
doesn't fit in one reasonable fetch, and filtering that client-side just delays the
problem rather than solving it.

- **New query params**: `source` (`arxiv | semantic_scholar | doaj`), `status`
  (`running | completed | failed`), `since`/`until` (date range on `started_at`), plus
  `page`/`pageSize` replacing the bare `limit`.
- **Existing indexes already cover this** — `crawl_history_source_idx`,
  `crawl_history_started_at_idx`, and `crawl_history_status_idx` all already exist on
  the table (`packages/db/src/schema/crawl-history.ts`). No new indexes needed for
  filtering; this is query-building work, not a schema change.
- **Query building**: mirror the `and()`/`gte()`/`lte()` conditional pattern already
  established in `apps/server/src/modules/papers/service.ts`'s `buildFilterConditions`
  — same shape, applied to `crawl_history` instead of `papers`.
- **Pagination style**: offset/page-number (`page` + `pageSize`), not cursor-based —
  matches the numbered-pagination UI already shown in the mockup ("1 2 3 Next"), and
  the table's expected scale (thousands to tens of thousands of rows over a long
  lifetime, not millions) doesn't need keyset pagination's complexity. Needs a
  `count(*)` alongside the filtered/paginated select so the UI can render "Showing
  1–8 of 214 runs" — same total-count-plus-page pattern likely already used for
  papers search results, follow that precedent rather than inventing a new one.

## 7. Stats endpoint — decided: combined aggregation queries, cached, one new index

**Decision (2026-08-01)**: the Overview page's stats endpoint (`GET /api/admin/stats`
or similar) is built for a growing `papers` table from the start, not optimized later.
Three concrete rules, not just "make it fast":

**Caching** — reuse the existing Redis cache helpers (`cacheGet`/`cacheSet`/`cacheDel`
in `apps/server/src/lib/cache.ts`), same pattern papers search already uses:
- Cache the whole stats response under one key (e.g. `"admin:stats"`) with a short TTL
  (30–60s) — there's no per-user variance for an admin-only endpoint, so one shared
  cache entry serves every request.
- Invalidate proactively, not just on TTL expiry: `processJob` (`queue.ts`) already
  calls `cacheDel("papers:*")` / `cacheDel("journals:*")` after a successful insert
  batch — add `cacheDel("admin:stats")` at the same point, so the dashboard doesn't
  show stale counts for up to a minute right after a crawl completes.

**SQL query shape** — minimize round trips via conditional aggregation instead of
separate queries per stat:
- `totalPapers`, `papersAdded24h`, `papersAdded7d`, and `embeddingCoveragePercent` all
  come from **one query** against `papers` using Postgres's `FILTER` clause, e.g.
  `COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')` and
  `COUNT(*) FILTER (WHERE embedding_stored) * 100.0 / NULLIF(COUNT(*), 0)` — one table
  scan/index range read, not four.
- `bySource` breakdown — one `GROUP BY source` query, separate from the above (different
  aggregation shape), using the existing `papers_source_idx`.
- `activeSchedules` / `runningNow` — two small queries against `crawl_schedule` /
  `crawl_schedule_run`; both already have the indexes they need
  (`crawl_schedule_enabled_idx`, `crawl_schedule_run_status_idx`) and stay cheap
  regardless, since these tables have nowhere near `papers`' row count.
- **`attention` (schedules whose last run failed, or runs past their estimate)** — do
  **not** loop per-schedule in application code (N+1). Use Postgres's
  `DISTINCT ON (schedule_id) ... ORDER BY schedule_id, started_at DESC` to get every
  schedule's most recent run in a single query, then filter that result set to failed
  ones / ones past `started_at + total_requests_estimate * 1.1s` (same formula
  `estimateTotalRequests` already uses elsewhere — reuse it, don't reimplement it).

**Schema addition**: `papers` currently has no index on `created_at` — needed for the
24h/7d growth queries above to range-scan instead of full-table-scan as the catalog
grows. Add `papers_created_at_idx` alongside the existing indexes in `papers.ts`. This
is the one new index this endpoint requires; everything else reuses what's already
there.

## 8. Open items to confirm before implementation

- arXiv category granularity for the *admin picker specifically* — full 155-code list, or grouped/collapsible by the 8 top-level groups for browsability. Doesn't affect the search-facing mapping (§3.2, which works at the group level regardless).
- Whether to keep the 3 seeded schedules separate (staggered cron times, one source each) or consolidate into fewer schedules with multi-source targets now that it's possible — no functional requirement either way, just an opinion call.
- Exact shape of the new `/admin` layout route and whether Overview/History/Users are separate routes or tabs within one route (affects whether shared guard logic lives in a layout route vs. a shared hook).

## 9. Deferred work (not blocking, tracked separately)

- **DOAJ LCC → canonical category mapping, all 538 terms** (§3.2). Architecture is decided; the mapping data itself is a standalone curation task. Until complete, unmapped terms fall back to "Uncategorized" as an interim state.
