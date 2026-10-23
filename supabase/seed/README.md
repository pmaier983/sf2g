# Fixture dataset

`010_fixtures.sql` and `EXPECTED.json` are **generated** by `scripts/gen-fixtures.ts` (`pnpm fixtures`). Don't edit them by hand; CI fails if they drift from the generator.

`supabase db reset` (or `pnpm db:reset`) loads every `*.sql` file here after the migrations.

## Riders

| # | Name | What it exercises |
|---|---|---|
| 1 | Ada Bayway | Mostly Bayway, some Royale/Other and non-commute rides, PPR dawn starts, Google destination, power + HR |
| 2 | Ben Skyline | Heavy Skyline/HMBW, frequent PPR at 6:00, Apple destination (ends in Mountain View) |
| 3 | Cam Mixed | Every route incl. Fleaway/MEBW/FEBW and Other, some reverse commutes |
| 4 | Dee Reverse | Half reverse (Peninsula → SF) commutes, Meta destination, never Skyline |
| 5 | Eve Weekend | 70% weekend rides — weekend filters |
| 6 | Fay Hidden | One hidden ride, one ride overridden to Royale, one marked not-SF2G (`ride_overrides`) |
| 7 | Gus NoRides | Connected, zero rides |
| 8 | Hal Deauthorized | `deauthorized_at` set, rides only through 2024 |
| 9 | Ivy NoScope | Empty `strava_scopes` (needs re-auth) |

Shared **group-ride days** (same route, overlapping times) are listed in `EXPECTED.json → groupDays`.

## Timing details that matter

- PPR @ 6am: qualifying rides start at Peet's (37.7734, −122.4389) at 06:00–06:03 Pacific. 30% of other rides start at Peet's at 05:xx — inside the `ppr_dawn_rides` window (04:00–07:59) but outside the ±10 min check. The rest start 07:00–09:59 elsewhere.
- "Now" for tests is `2026-10-16T19:00:00Z` (`app/test/local-supabase.ts`); the newest ride is 2026-10-15.

## EXPECTED.json

Per-rider totals computed by the generator in plain JS from the rows it writes — independent of the SQL views and server functions. `sf2gVisible` / `sf2gVisibleWeekdays` are what every leaderboard path should report (see `docs/rework/KNOWN_DISCREPANCIES.md`).
