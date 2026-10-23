# Known discrepancies

Places where the same number is computed differently depending on which code path runs. Each one is pinned by an executable test so a fix is provable. Found while building the phase 02 fixtures (2026-10-22).

"Truth" below is the generator's own count (`supabase/seed/EXPECTED.json`), computed in JS from the fixture rows, independently of the SQL views and server functions.

| ID | What the user sees | Root cause | Test | Fix in |
|---|---|---|---|---|
| **D1** | The **Exclude Weekends** chip is on by default, but the default Riders view counts weekend rides. | `leaderboardQueryOptions` never passes `excludeWeekends`. Without a date range, `fetchLeaderboard` reads `leaderboard_view`, which has no weekend filter. | `app/server/__test__/db/consistency.test.ts` → D1 (`it.fails`) | 03a (one SQL function takes `exclude_weekends`) + 05a (URL state passed through) |
| **D2** | With a date range set, turning weekends **on** still hides weekend rides. | Same: the flag isn't sent, and `get_leaderboard_by_date_range` defaults `p_exclude_weekends` to `TRUE`. | D2 (`it.fails`) | 03a + 05a |
| **D3** | Hidden rides still count on the default Riders view (and on any date range), but not once a route/company filter is added. | `leaderboard_view` and `get_leaderboard_by_date_range` don't filter `is_hidden`; the JS path (`fetchFilteredLeaderboard`), the Rides view and the profile ride list do. | D3 (`it.fails`) | 03a |
| **D4** | A rider's leaderboard SF2G count differs from their own ride list. | Consequence of D3 for riders with hidden rides. | D4 (`it.fails`) | 03a / 03c |
| **D6** ✅ fixed in phase 02 | Rides view infinite scroll could show a ride twice or skip one; JS aggregations that page through `rides` / views 1,000 rows at a time could double-count or miss rows at page boundaries. | Paginated queries (`.range()`) were ordered only by a non-unique column (`ride_date`, `month`, `user_id`, a sort column). Postgres doesn't guarantee a stable order among ties, so pages could overlap. Found as flaky goldens. | Stable goldens across 8 consecutive runs | Unique tiebreakers added in `rides.ts`, `leaderboard.ts`, `alltime.ts`, `group-rides.ts`; the loops themselves go away in 03 |
| **D7** ✅ fixed in phase 02 | Group-ride avatars appeared in a different order on each load. | Embedded `group_ride_members` select has no `ORDER BY`. | `consistency.test.ts` → "lists each group's riders in a stable order" | Sorted by name in `fetchGroupRides` |
| **D5** | Profile page: header says *573 SF2G rides / 21,642 mi*, the "SF2G Stats" card right below says *833 / 22,475 mi* (prod, Dan Padgett). | `ProfileRideStats` counts **"Other"** (unclassified commutes) as SF2G rides; the header and every leaderboard exclude "Other". Same label, two definitions. | Not yet executable (component logic) — add with the phase 05 component tests. | 03c (SQL returns both counts with distinct names) + 05e (labels) |

## Paths that agree with truth today

Pinned as normal (passing) tests in `consistency.test.ts`:

- `fetchFilteredLeaderboard` with `excludeWeekends: true` / `false` → matches visible weekday / visible totals.
- Rides view `totalCount` → equals the sum of visible SF2G rides.
- Profile ride list → excludes hidden rides.

## How to use this

- When a fix lands, its `it.fails` starts passing, Vitest reports "expected to fail but passed", and you remove `.fails` in the same PR.
- New discrepancies go here with an ID, plus an `it.fails` test that encodes the *correct* behavior.
