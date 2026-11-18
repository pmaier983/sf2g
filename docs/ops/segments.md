# Segment leaderboards (phase 09)

How `/segments` gets its data and what to do when it looks wrong. Design and
decisions: `docs/rework/phase-09-cumulative-segments.md`.

## How data arrives

1. Every 5-minute tick, `plan_segment_jobs` queues KOM refreshes (5 segments
   not checked in 7 days) and, while fewer than 5 `segment_efforts` jobs are
   open, the next rides to fetch. Each route's first 150 rides go first (the
   curation sample), then everything newest first.
2. A `segment_efforts` job reads one activity with all its segment efforts
   (1 Strava read). `ingest_ride_segment_efforts` then upserts the segments
   and folds the efforts into `segment_bests`: one row per rider, segment and
   year, that year's PR plus an effort count. Individual efforts are not
   stored.
3. `/segments` makes one `get_segment_matrix` call per route, direction and
   year. The browser does the rest.

Strava allows ~1,000 reads a day; rider syncs use ~300, so expect ~500
segment rides a day. The drain stops at 85 % of either limit.

## DevTools → Segments

| Button | When |
|---|---|
| Load segment stats | Progress: rides pending/fetched, segments selectable/core, PRs stored, jobs |
| Backfill segment efforts | Only to queue a burst at once; the tick already does it |
| Reclassify segment corridors | After a reference line or a `core` range changes |
| Curate segments | After reclassifying, and every few weeks as new segments appear |
| Ride share by position | The "core" chart: share of rides per segment along the line. Hide a segment or give it a curated rank (always selectable) here, then Curate |
| Find typical rides / Streams | Choosing a new route's reference ride (below) |

## Something looks wrong

- **A rider is missing.** They hid their times (`users.segment_board_hidden`),
  or their rides are not fetched yet (`segment_efforts_fetched_at IS NULL`),
  or the ride is private/hidden.
- **A time looks too fast** (GPS glitch). Hide the segment, or hide the ride
  on SF2G. Hiding the ride drops that rider's bests for the year and refetches
  their other rides from that year.
- **Bests look wrong for a rider** (e.g. after a bug). Clear
  `segment_efforts_fetched_at` on their rides and delete their
  `segment_bests` rows; the backfill rebuilds them.
- **A KOM crown is stale.** KOM times refresh weekly; the tooltip shows when
  it was checked.

## Adding Bayway / HMBW

1. DevTools → Segments → Route: Bayway → **Find typical rides**, then
   **Streams** on the top one (fetched with that rider's token, not stored).
2. `node scripts/gen-corridor-profile.ts --corridor bayway --activity <id>
   --streams <file> --start <core start lat,lng> --end <core end lat,lng>`.
   Use the core boundaries, so the line never shows where the rider lives or
   works.
3. In a PR: the printed polyline and a `core` range in `SEGMENT_CORRIDORS`
   (`app/lib/constants.ts`), the profile loader entry
   (`app/lib/corridor-profile.ts`), remove the route from `COMING_SOON`
   (`CorridorTabs.tsx`), and a migration that adds it to
   `segment_ingest_categories()`.
4. After deploy: Reclassify, wait a day for the 150-ride sample, look at
   Ride share by position, adjust `core`, then Curate.
