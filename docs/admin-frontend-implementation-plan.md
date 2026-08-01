# Admin Dashboard — Frontend Implementation Plan

Written for a fresh Claude Code session with no prior context on this work. Read this
whole document before starting; it assumes nothing beyond what's in the repo and the
two companion docs below.

**Read first, in this order:**
1. `docs/admin-ux-spec.html` — open it in a browser. The authoritative description of what each of the four pages (Overview, Schedules, History, Users) needs to do, page by page, flow by flow.
2. `docs/ui-design/Admin Dashboard.dc.html` — open it in a browser (needs internet access; it self-loads React/ReactDOM/Babel from CDN, no build step). A high-fidelity interactive mockup of all four pages with real mock data. **Keep `./support.js` in the same directory** — the `.html` file depends on it. Use this for exact visual/copy reference, not just the prose spec.
3. `docs/admin-dashboard-tech-spec.md` — technical decisions, most relevantly §3.2 (category split), §4 (UI interaction architecture — the modal/drawer vs. conditional-render rule), and §5 (missing component primitives).

**Companion doc**: `docs/admin-backend-implementation-plan.md` covers the API side. **This frontend plan has a hard dependency on that plan's Phases 1–2 (schema + logic) being done first** — the Schedules page rework needs `source` to exist on targets, not schedules, and the new `/api/crawl/schedules` response shape. That plan's Phase 6 (history filtering/pagination) blocks this plan's History page; Phase 7 (stats endpoint) blocks this plan's Overview page; nothing else here is blocked by it.

## Current state (verify this before starting — it may have changed)

- `apps/web/src/routes/admin/crawler.tsx` — the existing Schedules page. Built against the **old** single-source-per-schedule model — most of it needs reworking, not just extending, once the backend's target-level `source` change lands.
- `apps/web/src/lib/hooks/use-schedules.ts` — TanStack Query hooks (`useSchedules`, `useCreateSchedule`, `useUpdateSchedule`, `useDeleteSchedule`, `estimateRun`, `useConfirmRun`, `useScheduleRun`, `useCancelRun`) built on the Eden treaty client (`apps/web/src/lib/api/treaty.ts`). Types here need updating once the backend response shape changes (`source` moves from schedule to target level).
- `apps/web/src/lib/auth-client.ts` — better-auth React client with `adminClient()` already loaded. `authClient.admin.*` (listUsers, createUser, setRole, banUser, unbanUser, removeUser, listUserSessions, revokeUserSession(s)) is already callable — **the Users page needs no new backend work**, it's a pure frontend build against an existing client.
- `apps/web/src/routes/login.tsx` — existing sign-in page.
- `apps/web/src/components/layout/header.tsx` — has a mount-gated admin nav link to `/admin/crawler` and sign-in/out. Will need updating once there's a proper `/admin` shell with more than one destination.
- `packages/ui/src/components/` — existing primitives: `button`, `card`, `input`, `label`, `badge`, `checkbox`, `dropdown-menu`, `separator`, `skeleton`, `sonner`. All built on `@base-ui/react` primitives (see `dropdown-menu.tsx` wrapping `@base-ui/react/menu` for the established pattern). **No multi-select, no dialog/modal exist yet** — both need building before Phases 2–3 below.

Run `bun run check-types` and `bun test` from the repo root before starting, to confirm
the baseline is green.

---

## Phase 1 — Missing UI primitives (tech spec §5)

Both of these block later phases; build them first.

1. **Dialog/modal** — `packages/ui/src/components/dialog.tsx`. Wrap `@base-ui/react/dialog` following the exact structural pattern `dropdown-menu.tsx` uses for `@base-ui/react/menu` (root/trigger/portal/content sub-components, `cn()` for class merging, `data-slot` attributes). This one primitive gets reused three ways per the tech spec's §4 architecture: the run-now flow (anchored to the schedule that triggered it), the sessions panel (as a drawer-style dialog), and ban/remove confirmation (standard dialog).
2. **Multi-select** — `packages/ui/src/components/multi-select.tsx`. A checkbox-list rendered inside the existing `dropdown-menu` primitive (trigger button showing "N selected", popover content with a scrollable checkbox list) — check whether `@base-ui/react` has a more direct combobox/multi-select primitive before building this from `dropdown-menu` + `checkbox` by hand; use the more direct primitive if one exists and fits. Needs to handle DOAJ's 538-option case reasonably (a search/filter input inside the popover, not a flat unfiltered list of 538 checkboxes).

## Phase 2 — Admin shell

Currently there's just one standalone route (`/admin/crawler`) with its own inline
auth-gate logic. Replace with a proper shell per the tech spec's open item in §6 (routes
vs. tabs is your call — recommend separate TanStack Router file routes under
`routes/admin/`, since it gives clean URLs and matches the existing route file
convention rather than inventing tab state).

1. Create `apps/web/src/routes/admin/route.tsx` (or `_layout.tsx` — check TanStack Router's current layout-route convention/version in this repo before naming it) as a layout route wrapping all `/admin/*` children: persistent nav (Overview / Schedules / History / Users), signed-in-as indicator, sign-out.
2. Move the mount-gate + role-check logic (currently duplicated between `crawler.tsx` and `header.tsx` — see the mount-gate comments in both files from earlier work) into this one layout route. Every child route trusts the layout already gated it; don't re-check per page.
3. Update `header.tsx`'s admin link to point at `/admin` (the shell's landing page — Overview) instead of directly at `/admin/crawler`.
4. Rename/move the existing `crawler.tsx` content to live under this shell as the Schedules page (`routes/admin/schedules.tsx` or `routes/admin/crawler.tsx` kept as-is under the new layout — either is fine, just be consistent with whatever the new Overview/History/Users routes are named).

## Phase 3 — Schedules page rework (multi-source targets)

This is the biggest single piece of frontend work. Depends on backend plan Phases 1–2
being complete (target-level `source`) and this plan's Phase 1 (multi-select, dialog).

Reference `docs/ui-design/Admin Dashboard.dc.html`'s "Schedules" tab for exact visual
treatment of every state described below — it already shows the 3-step create flow and
all 4 run-now states side by side as static reference panels.

1. **List view**: each schedule row/card now shows one badge per **distinct source across its targets** (dedupe `targets.map(t => t.source)`), not a single source value — the backend response no longer has a schedule-level `source` field at all (backend plan Phase 2).
2. **Create/edit form — target rows**: each target row needs, in this order:
   - Source dropdown (arxiv / semantic_scholar / doaj) — **chosen first**, drives everything else in the row.
   - Label (free text).
   - Query field — **conditionally rendered, only when that row's source is `semantic_scholar`**, marked required, inline validation error if blank.
   - Categories — the new multi-select (Phase 1), sourced from `GET /api/crawl/taxonomies` (backend plan Phase 4): arXiv's grouped 155-code list, Semantic Scholar's `FIELDS_OF_STUDY`, or DOAJ's 538 LCC terms depending on the row's source.
   - Max records (numeric, existing field).
   - Remove-row action (disabled when it's the last remaining row).
   - "Add target" below the list, defaulting a new row to no source selected (forcing the admin to choose, not silently defaulting to one).
3. **Review step**: computed summary before save — target count, distinct sources involved, combined max records (per the UX spec's 3-step flow).
4. **Run-now flow**: rework into the Phase 1 dialog primitive, anchored to the triggering schedule (tech spec §4 — this was previously inline in the page, needs to move into the modal). Keep the existing estimate → two-tier-confirm → progress → cancel logic from `use-schedules.ts` (`estimateRun`, `useConfirmRun`, `useScheduleRun`, `useCancelRun`) — this part doesn't change, only its presentation (modal instead of inline card) does.
5. Update `use-schedules.ts`'s TypeScript types (`Schedule`, `TargetInput`, `CreateScheduleInput`, `UpdateScheduleInput`) to match the new backend shape — `source` moves from the schedule level into each target.

## Phase 4 — Crawl History page

New route under the admin shell. Depends on backend plan Phase 6 — `GET
/api/crawl/history` gets extended there with `source`/`status`/`since`/`until`/`page`/
`pageSize` query params and a total count. Build the UI against that extended shape
directly; **do not filter client-side** — decided (tech spec §6) precisely because
that doesn't hold up once schedules have been running for months.

1. Filter bar: source, status, date range (per UX spec) — each one a real query param on the request, not a client-side `.filter()` over an already-fetched page.
2. Table: started, source, status (chip — see Phase 6 below), papers found/inserted/skipped, duration, parent schedule (linked back to the schedule's edit page).
3. Row detail: **expand-in-place under the row** (tech spec §4 — decided, not a side panel), showing full error list + exact options used for that run.
4. A `running` row needs a visually distinct treatment from a finished one (background tint or similar — see the mockup's `rowStyle` handling for the `running` status).
5. Pagination controls driven by the endpoint's returned total count (backend plan Phase 6, point 4) — "Showing X–Y of N" plus page-number controls, matching the mockup.

## Phase 5 — User management page

No new backend work needed — build directly against `authClient.admin.*` from
`apps/web/src/lib/auth-client.ts`.

1. Table: email/name, role chip, status chip (active/banned), created date, actions.
2. **Root admin's row**: role/ban/remove actions rendered visibly disabled (not just non-functional) with a caption explaining why ("Root admin cannot be modified") — check the session's `role` field (`root_admin`) to detect this row, don't rely on a hardcoded email.
3. "Create account" as a prominent primary action (there's no public sign-up — this is the only path to a new account).
4. Sessions panel: Phase 1's dialog, triggered from a row's "Sessions" action — list active sessions via `authClient.admin.listUserSessions`, individual "Revoke" (`revokeUserSession`) plus "Revoke all" (`revokeUserSessions`).
5. Ban/remove confirmation: Phase 1's dialog, standard confirm weight (not the typed-phrase escalation the Schedules run-now flow uses — per tech spec §4/UX spec, this one's lower-friction).

## Phase 6 — Overview page

Depends on backend plan Phase 7 (`GET /api/admin/stats` or equivalent — confirm the
actual endpoint path/shape landed, this doc may be describing an earlier plan than what
was actually built). That phase also specifies response caching (30–60s TTL) — the
frontend doesn't need its own polling/refresh logic beyond a normal query refetch;
don't build client-side caching on top of what the backend already does.

1. Attention strip — only renders when there's something to show (a failed last-run, an overrunning run); empty/hidden otherwise, not a permanent empty-state box.
2. Stat tiles: total papers, +24h, +7d, embedding coverage %, active schedules, running now.
3. Source breakdown: horizontal bar or similar per source, count + percentage.
4. Recent activity: last ~10 runs, each linking into the History page.
5. Loading state: skeletons shaped like the final tiles/rows, not a spinner.
6. Fresh-install empty state: 0 papers, 0 schedules — needs a real "Create your first schedule" CTA, not a wall of zeroes (see mockup's "Fresh install — empty" reference panel).

## Phase 7 — Shared conventions across all four pages (tech spec §4)

Apply consistently, don't re-derive per page:

- **Rule**: transient/action-triggered → modal/drawer (Phase 1's dialog); different data states of the same view → conditional render in place based on query state, never a route change.
- Every list page needs an empty state with a next action, not just "no data."
- Every mutation (create/update/delete/run/cancel/ban/revoke) gets a toast via the existing `sonner` component — success and failure both, not just failure.
- One consistent status-chip visual language reused across all four pages (schedule enabled/disabled, run status, crawl history status, user active/banned) — build this as one shared component/variant set, not four independent implementations.

## Verification checklist before calling this done

- [ ] `bun run check-types` clean.
- [ ] `bun test` clean.
- [ ] Run `bun run dev:web` + `bun run dev:server` together, manually click through all four pages as a signed-in root admin.
- [ ] Manually verify a non-admin session cannot reach any `/admin/*` route (redirect or blank, per the shell's guard).
- [ ] Manually verify the root admin's row in Users genuinely cannot be banned/demoted/removed via the UI (not just visually disabled — confirm no request is even fireable).
- [ ] Create a schedule with targets across all three sources in one form submission, confirm the category multi-select correctly swaps option lists per row as the source changes.
