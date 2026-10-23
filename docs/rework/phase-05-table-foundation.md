# Phase 05 — Table foundation

## Goal
Every table on the site is driven by one validated `TableQuery` living in the URL, rendered through one shared `<DataTable>` shell, and backed by one SQL function (Phase 03). Filters, sorting, pagination and column resizing behave identically everywhere; the known table bugs are fixed and each fix has a test. Visual design and features are unchanged.

## Why
State is split across a 23-field hand-parsed URL object and component state, applied partly client-side and partly server-side; 20+ commits patched individual table symptoms (F3.1–F3.3). Phillip likes how the tables look and what they do; he does not trust that they show the right thing.

## Prerequisites
- Phase 02 (component test setup). 05a can start before Phase 03 and is a prerequisite for 03's server-function validators (or 03a defines `TableQuery` first and 05a adopts it — whichever lands first owns `app/lib/table-query.ts`).
- 05c–05e require the corresponding Phase 03 sub-phase (SQL function) merged.

## Scope
Five PRs.

### 05a — `TableQuery` schema and URL state
- In: `zod` dep, `app/lib/table-query.ts` (schema, defaults, `parseSearch`, `serializeSearch`, per-view sort allow-lists, preset → date range in `America/Los_Angeles`), `app/lib/useTableQuery.ts` (TanStack Router `useSearch`/`navigate` wrapper), `app/routes/leaderboard.tsx` `validateSearch` replaced by `parseSearch`, tests.
- Out: component changes beyond swapping the hook in.

### 05b — Shared `<DataTable>` shell
- In: `app/components/table/DataTable.tsx`, `useDataTable.ts`, `columns.ts` helpers (unit-aware number/speed/distance/time cells, nullable sort), `TableStates.tsx` (loading skeleton, empty, error), move `useColumnResize.ts` here; component tests.
- Out: migrating any specific table (05c–e).

### 05c — Riders leaderboard on the shell
- In: `LeaderboardTable.tsx`, `LeaderboardColumns.tsx` → `riders.columns.ts`, `FilterChips.tsx` bound to `TableQuery`, remove duplicate mobile/desktop control instances, `leaderboard.tsx` riders view.

### 05d — Rides, All-time, Groups views
- In: `RidesLeaderboardTable.tsx`, `AllTimeTable.tsx`, `GroupRidesTable.tsx`, `RideSubTable.tsx`, the view switcher.

### 05e — Profile + group-ride detail tables and the bug list
- In: `ProfileRidesTable.tsx`, `RouteSpeedTable.tsx`, `GroupRideComparisonTable.tsx`; fixes for every item in `docs/rework/TABLE_BUGS.md`.

## Steps
1. **Collect the bug list first** (05a PR includes `docs/rework/TABLE_BUGS.md`): ask Phillip for his top repros; add the ones from the audit (two "Groups" buttons; 573 vs 833; resize-vs-sort conflicts from `ed703bf`; truncated headers from `10e8caa`/`2596d98`; jitter from `4480228`; null sorting from `7916af2`). Each entry: steps, expected, actual, which sub-phase fixes it, test name.
2. **05a — schema.** Zod schema per ADR-4 with `.catch(default)` on every field so a bad URL never throws. `serializeSearch` omits defaults. Presets resolve on the **server** (`resolveDateRange(preset, now, 'America/Los_Angeles')`) — the client sends the preset, not dates, unless custom dates are set. Tests: round-trip for every field; legacy URLs (`?routes=skyline,bayway&ppr=true&view=groups&gSort=date`) parse into the new shape (keep a one-release compatibility map so shared links still work).
3. **05a — hook.** `useTableQuery(view)` returns `{ query, set(patch), reset() }`; `set` always resets `page` to 1 unless the patch is a page change. Replace `updateSearch` and the three sort-key families in `leaderboard.tsx`.
4. **05b — shell.** `<DataTable table={table} rowHeight estimateSize sticky resizable density onRowClick renderSubRow />` using TanStack Table instance + Virtual. Owns: header with sort affordance (click = toggle, shift-click = multi? — no, keep single sort), resize handles that do **not** trigger sort (the `ed703bf` bug: separate pointer targets), `table-layout: fixed` widths from `useColumnResize`, keyboard focus ring, `aria-sort`. States component for loading/empty/error. Tests: renders N virtual rows for 10k fixture rows; sort click updates `aria-sort`; resizing a column does not change sort; empty state shows when `rows=[]`; error state shows message and retry.
5. **05c–05e — migrate one table per PR.** For each: write the column defs as pure data (`accessorKey`, `header`, `cell: (v, { unit }) => string`, `sortable`, `defaultDir`, `align`), delete the per-table copies of resize/sort/virtual logic, bind to the Phase 03 query hook, keep CSS classes so the look is unchanged. Snapshot test the rendered first row against fixture data in both unit systems. E2E: for each filter chip, assert URL param + first row changes as expected on the fixture.
6. **Numbers with names.** Wherever two totals can differ (profile header vs stats card), the SQL returns both with distinct names and the UI labels them (e.g. "SF2G rides (weekdays)" vs "SF2G rides (all)"). No derived totals computed in components.
7. **One DOM instance for controls.** Mobile/desktop filter bars become one component with CSS-driven layout; `MobileBottomBar`/`MobileSettingsPanel` open the same `FilterChips` instance.

## Acceptance criteria
- [ ] `grep -rn "validateSearch\|SEARCH_DEFAULTS\|rSort\|gSort" app` → 0 hits.
- [ ] Every `*Table.tsx` imports `DataTable`; `useColumnResize` has one call site (the shell).
- [ ] Every entry in `TABLE_BUGS.md` is checked off with a linked test.
- [ ] E2E: sharing a URL reproduces the exact table state (view, filters, sort, page) in a fresh browser context.
- [ ] Old-format URLs from before 05a still open the intended view and filters.
- [ ] Visual check by Phillip on localhost: riders, rides, all-time, groups, profile, group-ride detail look the same as before in light and dark mode, desktop and 400 px width.

## Verification
```bash
pnpm test -- table-query DataTable
pnpm test:db && pnpm e2e
pnpm dev   # manual pass through TABLE_BUGS.md
```

## Risks & rollback
- Subtle UX regressions (keyboard, scroll restoration, expanded sub-rows). Mitigate by migrating one table per PR and keeping the old component until the new one is wired, so a revert is one PR.
- URL compatibility: the legacy map in 05a prevents breaking shared links; remove it after a release.

## Size
05a ~400 lines, 05b ~600, 05c ~500 (mostly deletions), 05d ~600, 05e ~500. Five PRs.
