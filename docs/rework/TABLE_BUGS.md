# Table bugs

Every known table problem, its fix, and the test that keeps it fixed. From the
audit ([01-findings.md](01-findings.md)), the fix history (`git log --grep`
for the commits named below) and what turned up while building phase 05.
Phillip: add your own repros here (steps / expected / actual) and they get
a row.

| # | Bug | Steps → expected / actual | Fixed in | Test |
|---|-----|---------------------------|----------|------|
| T1 | Two "Groups" (and Riders/All Time/Rides) buttons in the DOM | Open /leaderboard on desktop → one view switcher / mobile and desktop switchers are both rendered; the hidden one is first, so it can't be clicked | 05c | `e2e/tables.spec.ts` "one view switcher" |
| T2 | Profile header 573 SF2G rides vs stats card 833 | Profile → same number / different definitions | 03c (D5) | `profile-stats.test.tsx` |
| T3 | Resizing a column also sorts it (`ed703bf`) | Drag a header's resize handle → width changes, sort unchanged / sort toggled on pointer-up | 05b | `DataTable.test.tsx` "resizing does not sort" |
| T4 | Truncated headers (`10e8caa`, `2596d98`) | Load any table → headers readable / clipped at default widths | 05b | `DataTable.test.tsx` "column width fits header" |
| T5 | Virtualized rows jitter while scrolling (`4480228`) | Scroll a long table → rows stay put / rows jump as heights are re-measured | 05b (fixed row height) | `DataTable.test.tsx` "fixed row height" |
| T6 | Nulls sort first / inconsistently (`7916af2`) | Sort by watts → riders without a power meter last in both directions / mixed in | 03a/03b SQL (`NULLS LAST`), 05b client columns | `sql-ports.test.ts`, `columns.test.ts` "nulls last" |
| T7 | Group rides: sorting by Route, Riders or Distance shows the arrow but sorts by date | Groups → click "Route" → sorted by route / server falls back to date | 05d (only server-sortable columns are sortable) | `table-query.test.ts` "validates sort against the current view", `GroupRidesTable` test |
| T8 | Sort state leaks between views | Sort Riders by Total Rides, switch to Rides → Rides default sort / three separate sort param families (`sort`, `rSort`, `gSort`) | 05a (one sort, reset per view) | `table-query.test.ts` "resets sort … switching views" |
| T9 | Date presets computed in the browser's time zone | "Today" at 9 pm in LA, or from another zone → LA's today / the browser's (and SSR hydrates differently) | 05a (`resolveDateRange` in America/Los_Angeles) | `table-query.test.ts` "dates in America/Los_Angeles" |
| T10 | Preset and its dates both stored in the URL | Pick "This Week", share the link next week → this week / last week's dates | 05a (preset stored by name) | `table-query.test.ts` "parses a legacy shared link" |
| T11 | `page` / `gPage` URL params with no effect | All views scroll infinitely; the params only changed the cache key | 05a (removed) | `table-query.test.ts` "never throws on garbage" |
| T12 | "Clear Filters" ignores Groups sort | Sort Groups, nothing else → Clear enabled / disabled | 05a (`hasActiveFilters` = any non-default param) | `table-query.test.ts` "hasActiveFilters" |
| T13 | Mobile settings drawer renders a second copy of every filter | Open the drawer → same controls / independent second instance | 05c | `e2e/tables.spec.ts` "one filter bar" |
