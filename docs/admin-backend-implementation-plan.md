# Admin Dashboard — Backend Implementation Plan

Written for a fresh Claude Code session with no prior context on this work. Read this
whole document before starting; it assumes nothing beyond what's in the repo and the
two companion docs below.

**Read first, in this order:**
1. `docs/admin-dashboard-tech-spec.md` — the technical decisions this plan implements. Every phase below references a section of that doc; don't skip it.
2. `docs/admin-ux-spec.html` — open it in a browser. Describes the four admin pages (Overview, Schedules, History, Users) this backend work supports.
3. `docs/ui-design/Admin Dashboard.dc.html` — a high-fidelity interactive mockup of all four pages (open `./support.js` alongside it, same directory, don't move one without the other).

**Companion doc**: `docs/admin-frontend-implementation-plan.md` covers the UI side. The two are sequenced to interlock — the frontend plan's Schedules-page rework depends on Phase 1–3 below being done first; its Overview page depends on Phase 5.

## Current state (verify this before starting — it may have changed)

The crawler scheduling system (schema, worker fan-out, API, guardrails) already exists
and is fully built and tested:
- `packages/db/src/schema/crawl-schedule.ts` — `crawlSchedule`, `crawlScheduleTarget`, `crawlScheduleRun` tables. **`source` currently lives on `crawlSchedule`, not the target** — this is what Phase 1 changes.
- `packages/db/src/schema/crawl-history.ts` — has `schedule_id` and `run_id`, but **no `target_id` yet** — Phase 1 adds it.
- `apps/server/src/modules/crawler/queue.ts` — worker, fan-out (`runSchedule`), reconciliation, ML backfill batching.
- `apps/server/src/modules/crawler/schedule-service.ts` — schedule CRUD, run-now estimate/confirm/cancel, `validateTargetsForSource`.
- `apps/server/src/modules/crawler/model.ts` / `index.ts` — TypeBox schemas and Elysia routes under `/api/crawl/schedules`.
- `apps/server/src/modules/crawler/sources/{arxiv,doaj,semantic-scholar}.ts` — per-source adapters.
- Auth (`apps/server/src/lib/auth.ts`, `auth-guard.ts`) — better-auth with `root_admin`/`admin` roles, `adminOnly` Elysia macro already usable on new routes.

Run `bun run check-types` and `bun test` from the repo root before starting, to confirm
the baseline is green. If it isn't, stop and investigate before adding to it.

---

## Phase 1 — Schema migration (tech spec §1, §3.2)

1. In `packages/db/src/schema/crawl-schedule.ts`:
   - Remove `source` from `crawlSchedule`.
   - Add `source: varchar("source", { length: 100 }).notNull()` to `crawlScheduleTarget`.
2. In `packages/db/src/schema/crawl-history.ts`:
   - Add `target_id: uuid("target_id").references(() => crawlScheduleTarget.id, { onDelete: "set null" })` (nullable, mirrors the existing `schedule_id`/`run_id` pattern). You'll need to import `crawlScheduleTarget` from `./crawl-schedule`.
3. In `packages/db/src/schema/papers.ts`:
   - Add `canonical_categories: jsonb("canonical_categories").$type<string[]>()` (nullable — tech spec §3.2). Add a GIN index on it, matching the existing `papers_keywords_gin_idx` pattern.
4. Generate and apply the migration: `bun run db:generate` then `bun run db:migrate` (run from repo root; these are turbo-wrapped scripts, see root `package.json`).
5. **Data migration for the 3 existing seeded schedules**: each currently has exactly one target and a `source` on the schedule row. Before/as part of the migration, backfill each target's new `source` column from its parent schedule's old `source` value. If you generate the migration via `drizzle-kit generate`, it won't do this data copy automatically — write a one-off SQL statement in the generated migration file (or a follow-up migration) that runs `UPDATE crawl_schedule_target t SET source = s.source FROM crawl_schedule s WHERE t.schedule_id = s.id` **before** dropping `crawl_schedule.source`. Check the actual current migration numbering under `packages/db/src/migrations/` before writing this — do not hardcode a filename from this doc, it may be stale by the time you run it.

## Phase 2 — Backend logic that follows from the schema move (tech spec §2)

All in `apps/server/src/modules/crawler/`:

1. `schedule-service.ts` — `validateTargetsForSource`: currently takes one `source` for the whole schedule. Change its signature to validate each target against its own `target.source` (reject with that target's `label` in the error message if `source === "semantic_scholar"` and `query` is missing). Update both call sites (`createSchedule`, `updateSchedule`).
2. `queue.ts` — `runSchedule`: currently reads `schedule.source` once and applies it to every target. Change to read `target.source` per target when building `CrawlOptions` and inserting each `crawl_history` row. Also write `target_id: target.id` onto each `crawl_history` insert (Phase 1's new column).
3. `queue.ts` — `getLastSuccessfulCrawlDateForSchedule`: rename to `getLastSuccessfulCrawlDateForTarget(targetId)`, filter `crawl_history` by `target_id` instead of `schedule_id`. Update the one call site inside `runSchedule` — it should now be called once per target, not once per schedule (each target needs its own watermark).
4. `schedule-service.ts` — `estimateRun`'s `sharedPoolWarning`: currently checks `schedule.source === "semantic_scholar"`. Change to: any target in the schedule has `source === "semantic_scholar"` and `env.S2_API_KEY` is unset.
5. `schedule-service.ts` — `toScheduleResponse`: drop `source` from the schedule-level response fields; it no longer exists on the row. Each target in the response already carries its own fields — add `source` there. The frontend derives a deduped "sources present" badge list itself (see frontend plan) — no new aggregation needed server-side.
6. `model.ts` — `CreateScheduleBody`/`UpdateScheduleBody`/`ScheduleTargetBody`: move `source: CrawlSource` from the schedule-level body into `ScheduleTargetBody`. Remove it from `CreateScheduleBody`'s top level. Update `ScheduleResponse`'s target shape to include `source`; remove `source` from the schedule-level response shape.
7. Check `apps/server/src/modules/crawler/schedule-service.ts`'s `ensureDefaultSchedules` (the boot-time seed function) — it currently sets `source` on the schedule insert and omits it from the target insert. Update it to set `source` per target instead, matching the new shape.

**Verify**: `bun run check-types` should catch every place that still references `schedule.source` or the old body shape — follow the compiler errors, don't guess at completeness.

## Phase 3 — DOAJ adapter rewrite + multi-category fan-out for both OAI-PMH adapters (tech spec §3.1, §3.3)

Two changes land together here because they touch the same code: the DOAJ rewrite
needs fan-out from day one (it has no top-level/subcode shortcut to lean on), and
fixing arXiv's existing fan-out gap at the same time avoids doing this twice.

**3a. DOAJ rewrite** — replace `apps/server/src/modules/crawler/sources/doaj.ts`'s
REST-based implementation with an OAI-PMH client, mirroring `arxiv.ts` in the same
directory — read `arxiv.ts` fully first, this is "adapt that pattern," not "design a
new one."

1. Base URL: `https://doaj.org/oai.article` (confirmed live and unauthenticated — see tech spec §3.1 for verification commands you can re-run yourself).
2. `metadataPrefix=oai_doaj`.
3. Reuse `fast-xml-parser`'s `XMLParser` exactly as `arxiv.ts` configures it, adjusting `isArray` for DOAJ's repeated elements: `author`, `keyword`, `affiliationName`, `record`.
4. Reuse the two-branch `buildUrl` pattern from `arxiv.ts` (`arxiv.ts:61-88`): first request carries `verb=ListRecords&metadataPrefix=oai_doaj&set=<setSpec>&from=<since>&until=<until>`; continuation requests carry only `verb=ListRecords&resumptionToken=<token>`.
5. Reuse the retry/backoff constants and shape already in `doaj.ts` (`REQUEST_DELAY_MS`, `MAX_RETRIES`, retry-on-429).
6. Map `oai_doaj:*` fields to `NewPaper`: `title`, `doi`, `journalTitle` → `journal`, `publicationDate` (full date, no more year+month guessing), `authors.author[].name` → `authors`, `abstract`, `keywords.keyword[]` → part of `keywords`, `fullTextUrl` → `source_url`.
7. **Get these two details right** (tech spec §3.1 flags both explicitly):
   - `oai_doaj:language` is a single three-letter code (ISO 639-2, e.g. `ind`, not the two-letter `id` the old REST version used). If the Indonesian-only scoping needs to carry over, it's now a post-fetch filter checking `language === "ind"`, not a query clause.
   - `oai_doaj` has **no subject/category field** — you cannot read a paper's category off the fetched record. The category is implicit in which `set` (i.e., which target/sub-harvest) produced it. Don't try to parse a subject out of the XML; thread the current category through from the fan-out loop instead (Phase 5 needs this for `canonical_categories`).
8. Existing tests in `doaj.test.ts` are written against the REST response shape — they'll need rewriting against OAI-PMH XML fixtures. Look at `arxiv.test.ts` for the testing pattern (it mocks XML responses).

**3b. Multi-category fan-out (tech spec §3.3 — decided: adapters fan out, UI stays unconstrained)**

Both `arxiv.ts` and (the just-rewritten) `doaj.ts` need to handle a target selecting
multiple categories that don't fit in one OAI-PMH `set` request:

1. **arXiv** — currently `buildUrl` only uses `options.categories[0]`'s top-level
   prefix for the actual fetch; every other category is a dead post-fetch filter that
   never matches anything outside that one group (confirmed by reading the current
   code — this is a real, pre-existing bug, not a hypothetical). Fix: group
   `options.categories` by top-level prefix, run one full harvest per distinct group
   (own resumption-token loop each), post-filtering each group's results by whichever
   subcodes were requested *for that group specifically*. A bare top-level category
   (no `.`) means "whole group, no subfilter."
2. **DOAJ** — no group/subcode structure exists in LCC the way it does for arXiv; every
   selected category is its own full harvest, no exceptions.
3. **Both**: iterate groups/categories sequentially (matches the worker's existing
   concurrency-1 model — no benefit to interleaving, and sequential preserves each
   source's existing rate-limit pacing without new coordination).
4. **`maxRecords` is a cumulative cap across the whole target**, not reset per
   group/category — stop once the running total across all sub-harvests hits it. This
   is why `estimateTotalRequests` doesn't need to change (tech spec §3.3) — don't touch
   it as part of this phase.
5. **Adapter interface change (tech spec §3.3, "Adapter interface change this forces")
   — do this as part of this phase, not as an afterthought in Phase 5**:
   - `SourceAdapter.crawl()` in `sources/types.ts:14` currently returns
     `AsyncGenerator<NewPaper[]>`. Change it to
     `AsyncGenerator<{ category: string | undefined; papers: NewPaper[] }>`.
   - Update **all three** adapters to this shape, not just arxiv/doaj — `semantic-scholar.ts`
     just yields one static category (its target's configured category) alongside
     every batch, since it never fans out; this keeps `processJob`'s consumption
     uniform across sources instead of branching by source.
   - Update all three adapter test files (`arxiv.test.ts`, `doaj.test.ts`,
     `semantic-scholar.test.ts`) — each has a local `collect()` helper typed against
     the old `AsyncGenerator<NewPaper[]>` shape that needs updating alongside the
     assertions that consume it.
   - This is *why* `processJob` can attribute a canonical category per batch in Phase 5
     — without this change, fan-out living inside the adapter's generator would leave
     `processJob` with no way to know which category produced a given batch.
   - Target-to-`crawl_history`-row cardinality does **not** change — still one row per
     target, regardless of how many categories/sub-harvests that target's `crawl()`
     call internally runs through. Fan-out is fully contained inside the generator;
     nothing about `runSchedule`'s per-target job creation needs touching for this.
6. Write tests for the multi-group case specifically — a target with categories
   spanning two different arXiv top-level groups (or two DOAJ terms) should yield
   results from *both*, not just the first. This is the exact bug this phase fixes;
   a test that doesn't cover it wouldn't catch a regression back to the old behavior.

## Phase 4 — Category taxonomy module (tech spec §3, §3.2)

1. Create `apps/server/src/modules/crawler/source-taxonomies.ts`. Export:
   - `ARXIV_TAXONOMY`: the 155 codes grouped by the 8 top-level groups (cs, econ, eess, math, physics [with its 12 sub-groups], q-bio, q-fin, stat). Full list is in the tech spec's history — re-fetch from `arxiv.org/category_taxonomy` if you need to double check completeness rather than trust a stale copy.
   - `DOAJ_LCC_TERMS`: all 538 `{ label, setSpec }` pairs from `doaj.org/oai?verb=ListSets` (note: the journal-feed base URL, `doaj.org/oai`, not `oai.article` — `ListSets` is shared across both feeds). **Both the label and its `setSpec` token must be stored together** — the token isn't derivable from the label and is required for the actual harvest `set=` parameter.
   - Re-export `FIELDS_OF_STUDY` from `apps/server/src/modules/papers/fields.ts` for convenience, or just import it directly where needed — don't duplicate the list.
2. Add `GET /api/crawl/taxonomies` in `apps/server/src/modules/crawler/index.ts` (gated `adminOnly`, same pattern as the other schedule routes) returning all three lists, shaped for the frontend's per-source category picker.
3. **Canonical-category mapping tables** (also tech spec §3.2 — this is separate from the taxonomy lists above, don't conflate them):
   - `ARXIV_GROUP_TO_CANONICAL`: maps each of the 8 top-level arXiv groups to a `FIELDS_OF_STUDY` entry. Cheap — 8 entries covers all 155 codes.
   - `DOAJ_LCC_TO_CANONICAL`: maps LCC term → `FIELDS_OF_STUDY` entry. **Only needs the 24 entries already implied by the existing `S2_TO_LCC` map in `doaj.ts` for now** — full 538-term coverage is explicitly deferred (tech spec §7), not part of this phase. Unmapped terms fall back to `"Uncategorized"`.

## Phase 5 — Apply canonical-category mapping at ingestion (tech spec §3.2)

In `apps/server/src/modules/crawler/queue.ts`'s `processJob` (or wherever papers are
inserted into the `papers` table — check current line numbers, they'll have shifted
after Phases 1–3). **This phase only works because Phase 3, point 5 changed the
adapter yield shape to `{ category, papers }`** — without that change, `processJob`
has no way to know which category produced a given batch once fan-out lives inside
the adapter's generator. Confirm that change landed before starting this phase.

1. Add a shared step, e.g. `resolveCanonicalCategories(source, category)`, called once per yielded `{ category, papers }` batch before insert, populating the new `canonical_categories` column:
   - `semantic_scholar` → identity (the yielded `category` already is a `FIELDS_OF_STUDY` value).
   - `arxiv` → look up the yielded `category`'s top-level group prefix (e.g. `cs.LG` → `cs`) in `ARXIV_GROUP_TO_CANONICAL`.
   - `doaj` → look up the yielded `category` (an LCC term) in `DOAJ_LCC_TO_CANONICAL`, falling back to `"Uncategorized"` if not yet mapped.
2. Because of Phase 3's fan-out + yield-shape change, every batch `processJob` receives already carries its own unambiguous `category` — no merging, no threading state through separately, just read it off the yielded object.
3. Don't overwrite the existing `keywords` column — it keeps holding raw source-reported terms exactly as today.

## Phase 6 — Crawl history: server-side filtering and pagination (tech spec §6)

Extends the existing `GET /api/crawl/history` (`service.ts`'s `getCrawlHistory`,
`index.ts`'s route) rather than replacing it. Client-side filtering was explicitly
rejected — see tech spec §6 for why.

1. Add query params: `source`, `status`, `since`/`until` (date range on `started_at`), and `page`/`pageSize` replacing the bare `limit`.
2. Build filter conditions the same way `apps/server/src/modules/papers/service.ts`'s `buildFilterConditions` does — `and()`/`eq()`/`gte()`/`lte()` composed conditionally, applied to `crawl_history` instead of `papers`.
3. No new indexes needed — `crawl_history_source_idx`, `crawl_history_started_at_idx`, and `crawl_history_status_idx` already exist and cover every filter here.
4. Return a total count alongside the paginated rows (a `count(*)` with the same filter conditions, no pagination) so the frontend can render "Showing X–Y of N runs."
5. Update `CrawlHistoryQuery` in `model.ts` to add the new optional params.

## Phase 7 — Stats endpoint for the Overview page (tech spec §7)

1. Add `GET /api/admin/stats` (or fold into the crawler module under `/api/crawl/stats` if that fits the existing module boundaries better — your call, but keep it `adminOnly`).
2. **Schema**: add `papers_created_at_idx` to `packages/db/src/schema/papers.ts` (no index exists on `created_at` today — needed for the 24h/7d growth queries below to range-scan rather than full-scan as the table grows). Generate + apply a migration for this alongside Phase 1's migration, or as its own — your call, but don't skip it.
3. **Query shape** — minimize round trips, don't write six independent queries:
   - `totalPapers`, `papersAdded24h`, `papersAdded7d`, `embeddingCoveragePercent` — **one query** against `papers` using Postgres `FILTER`, e.g. `COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')` and `COUNT(*) FILTER (WHERE embedding_stored) * 100.0 / NULLIF(COUNT(*), 0)`.
   - `bySource` — one `GROUP BY source` query (existing `papers_source_idx` covers it).
   - `activeSchedules` (`crawl_schedule` where `enabled = true and deleted_at is null`) and `runningNow` (`crawl_schedule_run` where `status = 'running'`) — two small queries, already-indexed, cheap regardless of scale.
   - `recentActivity` — last ~10 `crawl_history` rows, reuse `getCrawlHistory`'s query shape minus the per-job-id lookup.
   - `attention` — **do not loop per-schedule in application code.** Use `DISTINCT ON (schedule_id) ... ORDER BY schedule_id, started_at DESC` against `crawl_schedule_run` to get every schedule's latest run in one query, then filter that result to `status = 'failed'` or running-past-estimate (`started_at + total_requests_estimate * 1.1s` — reuse `estimateTotalRequests`'s existing formula, don't reimplement it).
4. **Caching** — reuse `cacheGet`/`cacheSet`/`cacheDel` from `apps/server/src/lib/cache.ts`:
   - Cache the whole response under one key (e.g. `"admin:stats"`), TTL 30–60s — no per-user variance to key on for an admin-only endpoint.
   - Add `cacheDel("admin:stats")` to `processJob` (`queue.ts`) at the same point it already calls `cacheDel("papers:*")`/`cacheDel("journals:*")` after a successful insert — proactive invalidation, not just TTL expiry.

## Verification checklist before calling this done

- [ ] `bun run check-types` clean across all packages.
- [ ] `bun test` clean.
- [ ] Boot the server (`bun run dev:server` or `cd apps/server && bun run src/index.ts`), confirm the 3 seeded schedules still register correctly post-migration (check server logs for `[crawler] registered trigger for schedule ...`).
- [ ] Manually create a schedule with targets on two different sources, confirm it validates and runs (mirrors the live curl-based testing done during the original Phase 2 build — same technique works here).
- [ ] Manually trigger a DOAJ target's run-now and confirm real papers land in `papers` with a sensible `canonical_categories` value, not silently empty or wrong.
- [ ] Manually create a target (arXiv or DOAJ) with categories spanning two different top-level groups/terms and confirm papers from **both** show up — this is the exact bug Phase 3b fixes; verifying only one group's results appear means the fix didn't take.
- [ ] Confirm `estimateTotalRequests` still returns the same value for a multi-group target as it did before Phase 3b (tech spec §3.3 — it shouldn't need to change; if it does, something's off).
- [ ] Hit the new history endpoint with each filter param individually and combined, confirm the returned count matches what's actually in the table for that filter.
- [ ] Hit the stats endpoint twice in quick succession, confirm the second is served from cache (check Redis directly, or time the two requests), then trigger a crawl and confirm the cache invalidates rather than showing stale numbers for the following minute.
