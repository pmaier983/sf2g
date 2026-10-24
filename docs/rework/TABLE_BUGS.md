# Table bugs

Every known table problem, its fix, and the test that keeps it fixed. From the
audit ([01-findings.md](01-findings.md)), the fix history (commits named
below) and what turned up while building phase 05. Phillip: add your own
repros here (steps / expected / actual) and they get a row.

| # | Bug | Steps → expected / actual | Fixed in | Test |
|---|-----|---------------------------|----------|------|
| ✅ T1 | Two "Groups" (and Riders/All Time/Rides) buttons in the DOM | Open /leaderboard → one view switcher / mobile and desktop switchers both rendered; the hidden one came first, so it couldn't be clicked | 05c | `e2e/tables.spec.ts` "one view switcher and one filter bar" |
| ✅ T2 | Profile header 573 SF2G rides vs stats card 833 | Profile → same number / two definitions | 03c (D5) | `profile-stats.test.tsx` |
| ✅ T3 | Resizing a column also sorts it (`ed703bf`) | Drag a header's resize handle → width changes, sort unchanged / sort toggled on mouse-up | 05b | `DataTable.test.tsx` "resizing a column does not change the sort" |
| ✅ T4 | Truncated headers (`10e8caa`, `2596d98`) | Load any table → headers readable / clipped at default widths | 05b | `DataTable.test.tsx` "default widths fit the header text", `columns.test.ts` "fitHeaderSize" |
| ✅ T5 | Virtualized rows jitter while scrolling (`4480228`) | Scroll the riders table → rows stay put / rows re-measured and jump | 05b (fixed row height) | `DataTable.test.tsx` "virtualizes large tables with a fixed row height" |
| ✅ T6 | Empty values sort first / inconsistently (`7916af2`) | Sort by watts → riders without a power meter last in both directions / mixed in | SQL `NULLS LAST` (03a/03b, `fetchUserRides`), client `sortRows` (05b) | `columns.test.ts` "nulls last in both directions", `DataTable.test.tsx` "puts empty values last", `profile-rides-sort.test.ts` |
| ✅ T7 | Groups: Distance (and Route) showed a sort arrow but the server sorted by date | Groups → click "Distance" → sorted by distance / sorted by date | 05d (only server-sortable columns are sortable) | `view-tables.test.tsx` "Groups: Route, Riders and Distance are not sortable", `table-query.test.ts` "validates sort against the current view" |
| ✅ T8 | Sort state leaked between views (`sort`, `rSort`, `gSort`) | Sort Riders by Total Rides, switch to Rides → Rides' default sort / separate param families | 05a | `table-query.test.ts` "resets sort to the new view's default when switching views" |
| ✅ T9 | Date presets computed in the browser's time zone | "Today" at 9 pm in LA, or from another zone → LA's today / the browser's (and SSR hydrated differently) | 05a (`resolveDateRange`, America/Los_Angeles) | `table-query.test.ts` "dates in America/Los_Angeles" |
| ✅ T10 | Preset and its dates both stored in the URL | Pick "This Week", share the link next week → this week / last week | 05a (preset stored by name) | `table-query.test.ts` "parses a legacy shared link" |
| ✅ T11 | `page` / `gPage` URL params with no effect | Every view scrolls infinitely; the params only changed the cache key | 05a (removed) | `table-query.test.ts` "never throws on garbage" |
| ✅ T12 | "Clear Filters" ignored the Groups sort | Sort Groups only → Clear enabled / disabled | 05a (`hasActiveFilters` = any non-default param) | `table-query.test.ts` "hasActiveFilters" |
| ✅ T13 | Mobile filters drawer rendered a second copy of every control | Open the drawer → the same controls / an independent copy | 05c | `e2e/tables.spec.ts` "mobile: the filters sheet holds the same controls" |
| ✅ T14 | Profile ride history sorted only the current page | Own profile → sort by Distance → longest rides overall / longest of the 25 on screen | 05e (server sort across pages) | `profile-rides-sort.test.ts` |
| ✅ T15 | Dead tables kept alive by tests | `RouteSpeedTable`, `RideSubTable` had no callers | 05d/05e (deleted) | — |
