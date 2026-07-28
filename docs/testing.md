# Test Suite

## Context

Before this work, the repo had no test framework wired up anywhere — zero test files, no `vitest`/`bun:test` scripts. `apps/web/package.json` already carried `@testing-library/react`, `@testing-library/dom`, and `jsdom` as devDependencies, but `vitest` itself was never installed and `vite.config.ts` had no `test` block — a prior attempt at web testing had been started and abandoned.

The goal was a **meaningful baseline**: real coverage of the highest-risk logic (search query construction, crawler XML/JSON parsing, cache serialization, filter/URL state), not exhaustive coverage. Full React component tests and DB-backed integration tests were scoped out as follow-up work.

## Approach

- **`apps/server`** and **`packages/ui`** → `bun:test`. Built into the Bun runtime already in use, zero new deps, Jest-compatible API (`describe`/`it`/`expect`/`mock.module`).
- **`apps/web`** → `vitest`. Completed the half-installed setup: added `vitest` + `@testing-library/jest-dom`, added a `test` block to `vite.config.ts`, environment `jsdom`.
- No test database. DB/Redis calls are mocked at the module boundary (`mock.module` in bun:test, `vi.mock` in vitest) rather than hitting real infra. A real-Postgres integration suite (docker compose already exists via `db:start`) is a natural follow-up, not part of this baseline.

## What's covered

Run everything with `bun run test` from the repo root (`turbo test`), or per package with `bun test` (server/ui) and `bun run test` (web, → `vitest run`).

### `apps/server` (36 tests, `bun:test`)

| File | What it covers |
|---|---|
| `src/modules/papers/fields.test.ts` | `isFieldOfStudy`, `fieldCondition` smoke tests (with/without arXiv prefix mapping) |
| `src/modules/papers/service.test.ts` | Pure query-building helpers exported from `service.ts` for testability: `parseArrayParam`, `buildFacets`, `buildOrderBy`, `buildSearchCondition`, `buildFilterConditions`, `toPaperResponse`, `searchCacheKey`. Plus orchestration tests (`mock.module` on `@scholar-seek/db` and `../../lib/cache`): cache-hit short-circuit, 404 on missing paper |
| `src/lib/cache.test.ts` | `cacheGet`/`cacheSet`/`cacheDel` against a mocked `getRedis()` |
| `src/modules/crawler/sources/arxiv.test.ts` | Deepest crawler coverage — valid record mapping, deleted-record filtering, `noRecordsMatch`, resumptionToken pagination, HTTP 503 retry/backoff, retry exhaustion — all via a mocked `globalThis.fetch` |
| `src/modules/crawler/sources/doaj.test.ts` | Shallow: one successful mapping, one non-retryable HTTP error |
| `src/modules/crawler/sources/semantic-scholar.test.ts` | Shallow: missing-query guard, one successful mapping (arXiv identity preference), one non-retryable HTTP error |

`crawler/queue.ts` (BullMQ orchestration, DB writes, Redis, ML backfill call) was deliberately left out — it's almost entirely side effects and better suited to an integration test against real Postgres/Redis.

### `apps/web` (14 tests, `vitest`)

| File | What it covers |
|---|---|
| `src/lib/search-state.test.ts` | `sessionStorage` save/get/clear roundtrip, malformed-JSON recovery |
| `src/lib/utils.test.ts` | `normalizeToArray`, `formatDate` (valid + invalid input) |
| `src/lib/hooks/use-filters.test.ts` | `activeFilterCount` computation and all setter functions, via `renderHook` + a mocked `useRouter` |

Full component tests (`result-card.tsx`, `filter-panel.tsx`, `search-bar.tsx`, etc.) were scoped out of the baseline.

### `packages/ui` (3 tests, `bun:test`)

| File | What it covers |
|---|---|
| `src/lib/utils.test.ts` | `cn()` — class joining, Tailwind conflict resolution, falsy-value handling |

## Infra changes

- `apps/server/package.json`, `packages/ui/package.json`: `"test": "bun test"`.
- `apps/web/package.json`: `"test": "vitest run"`; added devDeps `vitest`, `@testing-library/jest-dom`.
- `apps/web/vite.config.ts`: added a `test` block (`environment: "jsdom"`, `globals: true`, `setupFiles: ["./src/test-setup.ts"]`); new `apps/web/src/test-setup.ts` imports `@testing-library/jest-dom/vitest` and sets `globalThis.IS_REACT_ACT_ENVIRONMENT = true`.
- `turbo.json`: added a `test` task.
- Root `package.json`: added `"test": "turbo test"`.
- `apps/server/src/modules/papers/service.ts`: several previously-private helper functions and the `SearchPapersParams` interface were exported (no behavior change) so they're directly unit-testable without mocking Drizzle.
- `apps/server/tsconfig.json`: added `"exclude": ["dist", "**/*.test.ts"]` — see issue below.

## Issues faced

### 1. `tsc -b` was compiling test files into `dist/`, doubling test runs

`apps/server/tsconfig.json` is a composite project (`tsc -b`), which emits by default. Once `*.test.ts` files existed under `src/`, `bun run check-types` started compiling them into `dist/*.test.js`. Because `bun test` globs recursively for `*.test.*`, it picked up both the source and the compiled copies and ran every test twice (36 tests/6 files became 72 tests/12 files).

`dist/` is gitignored, so this never risked being committed, but it broke local `bun test` runs after any `check-types` invocation. Fixed by adding `"exclude": ["dist", "**/*.test.ts"]` to `apps/server/tsconfig.json` and clearing the stale `dist/`.

### 2. Vitest + React 19 hooks: "Invalid hook call" / dispatcher is null

The very first `renderHook`/`render` call from `@testing-library/react` failed with:

```
TypeError: Cannot read properties of null (reading 'useState')
Invalid hook call. Hooks can only be called inside of the body of a function component.
```

This happened even for a trivial `useState` test, and even with a manually-created `React.createRef`/`createRoot` component working fine outside of RTL. Ruled out over the course of debugging:

- Duplicate `react`/`react-dom` packages on disk (`bun pm ls` showed a single resolved copy of each).
- Running under Bun's runtime specifically (reproduced identically under plain Node with `node node_modules/.bin/vitest`).
- Missing `resolve.dedupe`, missing `test.server.deps.inline`, stale `node_modules/.vite` cache — none of these changed the outcome.

Root cause: the `tanstackStart()` Vite plugin (`@tanstack/react-start/plugin/vite`) applies SSR-oriented transforms to every module, including under Vitest's jsdom test run, and this broke React's internal dispatcher wiring specifically for RTL's render path (a plain `createRoot().render()` outside RTL was unaffected). Fixed by conditionally dropping `tanstackStart()` (and `tailwindcss()`, which isn't needed for tests either) from the plugin list when `process.env.VITEST` is set:

```ts
const isTest = Boolean(process.env.VITEST);

export default defineConfig({
  plugins: isTest
    ? [tsconfigPaths(), viteReact()]
    : [tsconfigPaths(), tailwindcss(), tanstackStart(), viteReact()],
  ...
});
```

### 3. Biome suppression-comment category mismatch

A `// biome-ignore lint/style/noVar: ...` comment on the `declare global { var IS_REACT_ACT_ENVIRONMENT }` augmentation failed `biome check` with `suppressions/parse` — `noVar` lives under the `suspicious` category in this Biome version, not `style`. Turned out to be moot: Biome's `noVar` rule doesn't fire inside `declare global` blocks at all, so the suppression comment was removed entirely rather than fixed.

### 4. Minor TS/lint cleanup

- `cacheGet<T>()` needed an explicit type argument in one test (`cacheGet<{ a: number }>(...)`) — without it, TS couldn't infer `T` and `expect(...).toEqual(...)` picked the wrong overload.
- Assigning a `bun:test` `mock()` directly to `globalThis.fetch` failed type-checking because Bun's `typeof fetch` includes a `preconnect` method the mock doesn't have — resolved with a narrow `as unknown as typeof fetch` cast at the assignment site.
- A few `toThrow(/regex/)` calls tripped Biome's `useTopLevelRegex` performance rule; regexes were hoisted to module-level `const`s.
