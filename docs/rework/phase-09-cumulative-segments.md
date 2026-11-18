# Phase 09 — Cumulative segment leaderboard (Skyline, Bayway, HMBW)

Written 2026-11-17 by Claude from Phillip's brief and read-only production counts taken the same day.
Builds on phase 07 (`phase-07-skyline-segments.md`, `phase-07c-route-view.md`): segment ingest, the Skyline reference line, the route view and `/segments` already exist. Read those first, then `CLAUDE.md`.

Six PRs (09a–09f), one session each. Items marked **(Phillip decides)** block the step that names them; everything else is implemented as written.

---

## 1. What we are building

On `/segments`, for each of the three primary routes:

1. **Cumulative leaderboard.** Pick a set of segments on the core of the route. Each rider's score is the sum of their best time (PR) on every segment in the set. Fastest total wins.
2. **Segment picker.** Presets (Core chain, All climbs, All flats), a min/max length slider, and manual on/off per segment on the elevation-profile lanes. The selection lives in the URL, so a board is shareable.
3. **Per-segment leaderboard**, Strava style: every connected rider's PR (unless they hid their times), rank, gap, date, link to the activity.
4. **Stats** per segment and per selection (§6).

## 2. What production looks like today (2026-11-17)

| Fact | Value | Consequence |
|---|---|---|
| Riders opted in to the segment board | **0 of 70** | The board is empty in prod. P1 switches it to opt-out, so all 70 appear. |
| Skyline rides with efforts fetched | 185 of 4,070 (14 riders) | Backfill only runs when the DevTools button is pressed; best day so far was 70 rides. It must run by itself (09a). |
| Rides to fetch for three routes | 4,070 Skyline + 3,465 Bayway + 178 HMBW = 7,713 | About 16 days at the ~500 reads/day left under Strava's 1,000/day limit. |
| Efforts stored per fetched ride | 251 on average; 38 % are on segments off the corridor, 11 % on descents | Storing every effort (phase 07, D11) does not scale: 7,713 × 251 ≈ 1.9 M rows ≈ 415 MB at the current 215 B/row. The database is 181 MB and the Free plan cap is 500 MB. Storing only bests (P7) brings it to about 100 k rows. |
| Southbound Skyline segments the board would show | 162, about 45 of them on Cañada Rd alone | Summing PRs over all of them counts the same road many times. The cumulative needs a **non-overlapping** set. |
| Riders with 5+ rides | Skyline 51, Bayway 34, HMBW 11 | HMBW will be a small board. |
| Direction | 97 % of rides on the three routes are SF→G (276 of 7,713 are G→SF) | v1 is southbound. Northbound stays available on Skyline but is thin. |

Share of the 185 fetched Skyline rides that have an effort on each stretch (a proxy for where riders join and leave):

| Stretch | Rides | Share |
|---|---|---|
| Great Hwy / Lake Merced | 151 | 82 % |
| John Daly Blvd → Hwy 1 | 164–176 | 89–95 % |
| Hwy 1 → Sneath → Hillcrest | 164–174 | 89–94 % |
| Hillcrest → Crystal Springs dam: **Skyline rollers** | 123–127 | 68 % |
| same stretch, **Sawyer Camp Trail** | 29–47 | 16–25 % |
| Crystal Springs dam → Cañada → Edgewood → Woodside Rd | 170–174 | 92–94 % |
| Sand Hill Rd | 155 | 84 % |
| Junipero Serra | 146–150 | 80 % |
| Foothill → Arastradero | 145 | 78 % |

So the Skyline core is **John Daly Blvd → Woodside Rd (Roberts Market)**, roughly 39 km, with one fork in the middle (rollers or Sawyer Camp). The sample is 14 riders and recent rides only; 09a recomputes it once more rides are in.

## 3. Decisions

| # | Decision | Value |
|---|---|---|
| P1 | Who appears (Phillip, 2026-11-18: "people consent when they first sign up") | **Every connected rider**, like the main leaderboard. Riders consent at SF2G sign-up. `segment_board_opt_in` becomes an opt-**out**: migration 051 renames it `segment_board_hidden boolean NOT NULL DEFAULT false`, and the RPCs filter `NOT segment_board_hidden`. The banner becomes only the existing "Hide my times" link, plus a way back in. 09a adds one bullet to "What's Publicly Visible" on `/privacy`: "Your best times on Strava segments along the SF2G routes". Rides the rider hid on SF2G (`rides.is_hidden`) are excluded like private rides. |
| P2 | Core of each route | A range `[coreStartM, coreEndM]` along the corridor's reference line, in `SEGMENT_CORRIDORS`. A segment is *core* when both projected endpoints are inside it. Skyline: John Daly Blvd → Woodside Rd **(Phillip confirms)**. Bayway and HMBW: from the ride-share curve after their sample backfill (09b) **(Phillip confirms)**. |
| P3 | Score | Sum of the rider's best `elapsed_time_seconds` on each selected segment, within the date filter. Private and hidden rides, and riders who hid their times, are excluded. |
| P4 | Riders missing a segment (Phillip, 2026-11-18: 80 %) | Ranked when they have a time on **at least 80 %** of the selected segments (`ceil(0.8 × N)`). Totals are comparable only when everyone rode the same segments, so a missing segment is filled with that segment's **slowest ranked time + 10 %**: a rider gains nothing by skipping it. The filled times show greyed in the splits, and the row is marked "8/10". Riders under 80 % are listed below as "n of N", unranked. `SEGMENT_CUMULATIVE_MIN_SHARE = 0.8` in `constants.ts`. |
| P4a | KOM recognition (Phillip, 2026-11-18) | Two separate honours, always shown with the rider's name: **Strava KOM** (gold crown ♛): the rider's best equals or beats the segment's current Strava KOM time (`best_seconds <= coalesce(overall_seconds, kom_seconds)`, refreshed weekly by `segment_xoms`). **Former Strava KOM** (outline crown): an effort had `kom_rank = 1` but the time is no longer the KOM. **SF2G record** (orange star ★): fastest SF2G rider on the segment, as today's "SF2G KOM". Prod today: 7 efforts with `kom_rank = 1`, 4 rider–segment pairs at or under the KOM time. |
| P5 | Overlaps | Presets return a non-overlapping chain (§5.2). Manual selection may overlap; the picker then shows "x km counted twice" and a "Remove overlaps" button. |
| P6 | The Skyline fork | The default chain leaves the Hillcrest → dam stretch out. Rollers and Sawyer Camp segments stay selectable by hand. |
| P7 | What is stored | **Bests only**, not every effort: one row per (rider, segment, calendar year) holding that year's fastest effort, plus how many efforts and rides it was chosen from. All-time PR = the minimum over years. This covers **every** segment a fetched ride touches, so the selectable set (§4.2) can change at any time without refetching rides. Efforts from private rides are never stored. `segment_efforts` (every effort) is retired. |
| P7a | Date filter | Whole years only: **All time**, **This year**, **Last year**, or any listed year. Rolling ranges ("last 30 days", "this month") are dropped from `/segments`; they would need per-month bests (about 4× the rows, still small) **(Phillip decides: years, or months)**. |
| P7b | A ride deleted or made private after ingest | Its best rows are deleted, and that rider's other fetched rides in the same year and route category get `segment_efforts_fetched_at = NULL`, so the backfill refetches them and rebuilds that year's bests. Rare; a few dozen reads each time. |
| P8 | Which rides count | A PR counts from any fetched ride, whatever its route category. A Cañada PR set on an HMBW day counts on the Skyline board. |
| P9 | Where the maths runs | One RPC returns the PR matrix (riders × selectable segments) for a corridor, direction and date range. The browser computes totals, ranks, presets and stats from it, so the slider and toggles need no request. |
| P10 | Directions | Southbound is the default and the only direction for Bayway and HMBW in v1. |
| P11 | Combined board across the three routes | Out of scope for v1 (§10). |

## 4. Data

### 4.1 Migration `051_segment_core.sql` (09a)

```sql
ALTER TABLE segments
  ADD COLUMN along_start_m real,          -- projection of start/end on the corridor line
  ADD COLUMN along_end_m   real,
  ADD COLUMN in_core       boolean NOT NULL DEFAULT false,
  ADD COLUMN selectable    boolean NOT NULL DEFAULT false,
  ADD COLUMN duplicate_of  bigint REFERENCES segments(id),  -- set by the de-duplication
  ADD COLUMN sf2g_rides    int NOT NULL DEFAULT 0;          -- fetched rides with ≥ 1 effort on it (ride share, §4.4)

CREATE TABLE segment_bests (
  user_id              uuid   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  segment_id           bigint NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  year                 smallint NOT NULL,                   -- of the ride's ride_date (LA time)
  effort_id            bigint NOT NULL,                     -- Strava effort id of the best
  ride_id              uuid   NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  ride_date            date   NOT NULL,
  elapsed_time_seconds int    NOT NULL,
  average_watts        real,
  kom_rank             smallint,                            -- best Strava top-10 rank seen this year
  effort_count         int    NOT NULL,                     -- efforts this year (laps of a segment count)
  first_ride_date      date   NOT NULL,                     -- first effort this year
  PRIMARY KEY (segment_id, user_id, year)
);
CREATE INDEX idx_segment_bests_user ON segment_bests (user_id);
CREATE INDEX idx_segment_bests_ride ON segment_bests (ride_id);
-- RLS like segment_efforts: no anon policy; read only through the SECURITY DEFINER RPCs.

-- Carry over what 07 already fetched (46 k efforts → about 6 k rows), skipping private rides.
INSERT INTO segment_bests SELECT … FROM segment_efforts e JOIN rides r … WHERE r.is_private IS NOT TRUE
  -- DISTINCT ON (segment_id, user_id, year) ORDER BY elapsed_time_seconds, start_date, plus the counts;
UPDATE segments s SET sf2g_rides = x.n FROM (SELECT segment_id, count(DISTINCT ride_id) n FROM segment_efforts GROUP BY 1) x WHERE x.segment_id = s.id;
```

`segment_efforts` stays in place, read by nothing, until 09e drops it with `get_segment_leaderboard`. That keeps a rollback path for one release.

**Ingest becomes one RPC** `ingest_ride_segment_efforts(p_ride_id uuid, p_segments jsonb, p_efforts jsonb) RETURNS jsonb` (service role). In one transaction it:
1. locks the ride row and returns `{skipped: true}` if `segment_efforts_fetched_at` is already set. That makes the counts idempotent when a job is retried.
2. upserts `segments` (summary columns only, as today) and adds 1 to `sf2g_rides` of each distinct segment in the ride;
3. folds the ride's efforts into `segment_bests` with `INSERT … ON CONFLICT (segment_id, user_id, year) DO UPDATE`: `effort_count += n`, `first_ride_date = least(…)`, `kom_rank = least(…)`, and the best columns replaced only `WHERE excluded.elapsed_time_seconds < segment_bests.elapsed_time_seconds`. A ride's own laps are reduced to its best in SQL before the upsert;
4. skips everything but step 1's flag when the ride is private;
5. sets `segment_efforts_fetched_at = now()` and returns the corridor segments whose `xoms_fetched_at IS NULL` (for the `segment_xoms` enqueue, unchanged).

`segmentEffortsStep` is then 1 Strava read + 2 Supabase calls (ride select, this RPC), down from 4.

**Deletions and privacy (P7b):** a trigger `AFTER DELETE ON rides` and `AFTER UPDATE OF is_private, route_category ON rides` deletes that ride's `segment_bests` rows. The `ON DELETE CASCADE` alone would leave the rider with no best for that year. The trigger then sets `segment_efforts_fetched_at = NULL` on the rider's other fetched rides of the same year and category, and the backfill rebuilds those bests. `sf2g_rides` is not decremented; it is a share estimate, not a ranking input.

`batch_update_segment_corridors` gains `along_start_m`, `along_end_m`, `in_core`. `reclassifySegmentCorridors` (07c) computes them with `projectOntoPolyline`; the new admin action `curateSelectableSegments` sets `selectable` and `duplicate_of` (§4.2). Both are DevTools buttons with `assertAdmin()`. Curation only decides what the page **shows**; bests exist for every segment, so it can be rerun at any time.

### 4.2 Choosing the selectable set — `app/lib/segment-curation.ts` (09a, pure)

Input: the core, non-descent, ≥ 300 m, non-hazardous, non-hidden segments of one corridor and direction, with `along_start_m`, `along_end_m`, `athlete_count`, and the ride share from `segment_ride_share` (§4.4).

1. **De-duplicate.** Two segments are duplicates when their starts are within 150 m along the line and their ends are within 150 m. Keep the one with the higher ride share, then the higher Strava `athlete_count`; the others get `duplicate_of`.
2. **Drop rarely ridden ones.** Ride share under 50 % is not selectable, unless an admin sets `curated_rank` on it (this is how the Sawyer Camp and rollers segments stay in).
3. **Cap at 40**, keeping the highest ride share, with at least 8 climbs and 8 flats when that many exist.

Admin overrides: `hidden` (never selectable) and `curated_rank` (always selectable), both already columns. DevTools gets a small table for the current corridor to flip them (this is phase 07d's curation, done here).

### 4.3 Backfill that runs by itself (09a)

- `enqueue_segment_backfill` takes route categories from a new `segment_ingest_categories()` SQL function (`skyline` now; `bayway` and `hmbw` added by 09b's migration) instead of the hard-coded `'skyline'`. The trigger and the partial index `idx_rides_segment_pending` change the same way.
- Order: first a **sample** of the newest 150 unfetched rides per category (so curation has data on every route), then everyone newest first.
- `scheduled.ts`: each 5-minute tick, when fewer than 5 `segment_efforts` jobs are open, call `enqueue_segment_backfill(5)`. That is one extra subrequest per tick. The drain already stops at 85 % of either Strava bucket, so rider syncs keep priority (D12).
- Expected: about 500 rides/day, 7,713 rides in about 16 days. Stored rows at the end: about 60 riders × 400 segments each × 1–5 years, roughly 100 k rows ≈ 15 MB. That covers every segment ridden, not only the curated ones.

### 4.4 Ride share — `segment_ride_share(p_corridor, p_direction)` (09a, service role)

Per segment: `sf2g_rides` ÷ fetched rides of that corridor's category. One SQL function, used by curation and by the DevTools "core" chart: share against along-track distance, which is how the table in §2 was made. The counter is filled by the ingest RPC, so it needs no stored efforts.

### 4.5 Bayway and HMBW corridors (09b)

The reference ride comes from **another rider's** ride, chosen from data rather than by hand. Phillip need not have ridden the route. The rides table already holds `summary_polyline` for 3,465 Bayway and 178 HMBW rides, and the app holds every connected rider's Strava token.

1. **Pick the most typical ride.** Admin server fn `suggestCorridorReference({ category })` (`assertAdmin()`) calls a new SQL function `corridor_reference_candidates(p_category, p_limit 200)`. It returns the newest 200 non-private, non-hidden SF→G rides of that category with `summary_polyline`, one subrequest. The Worker decodes them and scores each candidate by its median distance to the other rides. It samples 50 points per line with `distanceToPolylineMeters` and checks 40 random other rides, which fits the 10 ms CPU limit; if it does not, the script below does the same. The lowest score is the "medoid" ride: the one every other ride stays closest to. The function returns the top 5 with rider, date, length and score. Typical rides are the point, so no detours or coffee stops.
2. **Get its full-resolution geometry and elevation.** Admin server fn `fetchCorridorStreams({ rideId })` calls `GET /activities/{id}/streams?keys=distance,altitude,latlng` once with **that rider's** token (`ensureValidToken(user_id)`) and returns the streams to the DevTools panel as a download. It is 1 Strava read, nothing is stored server side, and it is the same call the 07c script made with Phillip's ride.
3. `scripts/gen-corridor-profile.ts --streams <file>` (unchanged from 07c) cuts at the core start and end, simplifies, and writes `constants.ts`'s polyline and `app/lib/corridors/<name>-profile.json`. Commit only the **cut** line. It starts and ends at the core boundaries, so it never shows where that rider lives or works. Record the activity id in the doc comment, as for Skyline.

Skyline can be rerun the same way later if its medoid differs much from Phillip's ride.

Migration `052`: widen the `corridor` CHECK to `('skyline','bayway','hmbw')`, add both categories to `segment_ingest_categories()`, add `corridor_reference_candidates`.

Then: sample backfill (150 rides each, about one day) → Reclassify → look at the ride-share chart → set `coreStartM/coreEndM` → Curate → Prune → the full backfill continues by itself.

Cores must not overlap between corridors (HMBW rejoins Skyline's line around Cañada Rd; its core ends before that). Then `segments.corridor` stays single-valued, which settles the risk noted in 07c §8.

### 4.6 The matrix RPC — `get_segment_matrix(q jsonb) RETURNS jsonb`, migration `053` (09c)

`SECURITY DEFINER`, granted to anon; the only read path to `segment_bests`. Input: `corridor`, `direction`, `year` (null = all time: `min` over the rider's years, taking the date and activity of the fastest, summing `effort_count`).

```json
{ "corridor": "skyline", "direction": "south",
  "segments": [ { "id": 1, "name": "…", "distance_meters": 3601, "average_grade": 3.5, "terrain": "climb",
                  "along_start_m": 4100, "along_end_m": 7700, "start_latlng": [..], "end_latlng": [..],
                  "kom_seconds": 429, "qom_seconds": 505, "athlete_count": 12196, "ride_share": 0.89,
                  "attempts": 2210 } ],
  "riders":   [ { "user_id": "…", "display_name": "…", "avatar_url": "…" } ],
  "cells":    [ [segIdx, riderIdx, best_seconds, "2026-03-05", strava_activity_id, effort_count, first_date] ],
  "years":    [2026, 2025, 2024] }
```

Only selectable segments, riders with `NOT segment_board_hidden`, and bests from rides that are neither private nor hidden. The user fields are exactly the three above. Each cell also carries `kom_rank` (best Strava rank this period, for P4a); each segment carries `overall_seconds`. `years` lists the years that have data, for the year picker. Expected size at full backfill: about 60 riders × 40 segments ≤ 2,400 cells, 60–100 KB of JSON. The query reads at most ~12 k rows by primary key, so there is no performance gate; a db test still asserts it finishes under 200 ms on 100 k seeded rows.

## 5. Logic in the browser — `app/lib/segment-cumulative.ts` (09c, pure, unit-tested)

### 5.1 Selection model (URL) — extends `SegmentQuery`

| Param | Values | Default |
|---|---|---|
| `corridor` | `skyline \| bayway \| hmbw` | `skyline` |
| `set` | `core \| climbs \| flats \| custom` | `core` |
| `min`, `max` | segment length in km, one decimal | open |
| `seg` | comma-separated ids, only with `set=custom` | — |
| `overlap` | `1` to allow overlapping segments in a preset | off |
| `view` | `cumulative \| segments \| crown` | `cumulative` |
| `direction` | as today | `south` |
| `year` | a year from `years`, or omitted for all time (replaces `range`, P7a) | all time |

Toggling a segment by hand turns any preset into `custom` with explicit ids. Every field `.catch()`es to its default, like the existing parser.

### 5.2 Functions

```ts
/** Segments matching the preset's terrain and the length range, before overlap handling. */
filterSegments(segments, { set, minKm, maxKm }): Segment[]
/** Largest-value non-overlapping subset: weighted interval scheduling on [along_start_m, along_end_m],
 *  value = length × ride_share. Deterministic (ties by id). 20 m of overlap is tolerated. */
resolveChain(segments): Segment[]
/** Metres counted twice in a selection. */
overlapMeters(segments): number
/** Totals and ranks for a selection. */
cumulative(matrix, selectedIds): {
  ranked: { rider, total_seconds, rank, gap_seconds, done, of, strava_koms, sf2g_records, splits: Split[] }[],  // ≥ 80 % (P4), gaps filled
  partial: { rider, done: number, of: number, total_seconds, splits }[],      // under 80 %, unranked
  dream:  { total_seconds, splits },   // fastest SF2G time on each segment
  kom:    { total_seconds | null },    // sum of Strava KOMs, null if any is unknown
  distance_m, climb_m }
/** One segment's full board from the matrix. */
segmentBoard(matrix, segmentId): { rider, best_seconds, rank, gap_seconds, pct_of_kom, date, activity, efforts }[]
```

`Split` = `{ segment_id, seconds, filled: boolean, rank, behind_leader_seconds, date, strava_activity_id, honour: 'strava_kom' | 'former_kom' | 'sf2g_record' | null }`. `honour(cell, segment, segmentLeaderSeconds)` is its own exported pure function, so the board, the splits and the crown all agree on it. A Strava KOM outranks an SF2G record when a rider holds both.

`core` = `resolveChain(all selectable)`; `climbs` / `flats` = `resolveChain` of that terrain. With the sample data the Skyline core chain comes out close to: Olympic Club to Hwy 1 (3.6 km climb) → Hwy 1 to Sharp Park Rd (3.7 km) → Skyline: Sneath to Hillcrest (4.9 km) → Crystal Springs Rd to 92 (2.8 km) → Canada → Edgewood (6.4 km) → Cañada southbound, Edgewood to Woodside (5.5 km): about 27 km timed out of 39.

## 6. Stats

Per selection (cards above the table): riders ranked / partial, distance and climbing timed, **dream ride** (sum of the fastest SF2G time per segment) and who holds how many of its pieces, sum of Strava KOMs and the leader's % of it, tightest gap between 1st and 2nd.

Per rider (expanding a row): split per segment with rank and time behind the segment leader, the segment where they lose the most and gain the most against the rider above them, date of their newest PR, their total as average speed over the timed distance.

Per segment (the segment view): riders, total attempts (sum of `effort_count`), median PR, fastest SF2G time against Strava KOM/QOM, most attempts ("local legend"), newest PR, share of rides that cover it (`sf2g_rides`), 1st–2nd gap. A second pass, if wanted: year-over-year PR progression (one best per year is exactly what is stored) and a tailwind badge on PRs (join `ride_id` to `rides.tailwind_component_ms`). A finer progression chart (every effort) is not possible with bests only; that is the trade.

KOM honours (P4a) appear wherever a rider's time does: next to the name in the cumulative table (with a count, "♛ 2 ★ 5"), on each split, as the first row of a segment board, and on the segment row itself ("Strava KOM held by an SF2G rider"). The crown view gets a **Strava KOMs** column, sorted first. A banner above the tables lists every SF2G rider who currently holds a Strava KOM on this route, since that is the rarest honour. Hovering or tapping the crown shows "Strava KOM, 3:34 (checked 2 days ago)" using `xoms_fetched_at`.

All of these come from the matrix; no extra request.

## 7. UI (09d, 09e)

```
[Skyline] [Bayway] [HMBW]                                   corridor tabs (exist)
map + elevation profile + segment lanes                     exists; lanes become the picker:
                                                            selected = filled, unselected = outline, click toggles
Set: (Core) (Climbs) (Flats) (Custom)   Length ├──●────●──┤ 0.3–12 km   Direction · Time
"7 segments · 27.1 km · 310 m"   [Remove overlaps]  [Copy link]
[Cumulative] [Segments] [Crown]                             view switch
```

- **Cumulative** (09d): `DataTable` — Rank, Rider, Total, Gap, Avg speed, Segments (n/N), % of KOM sum. Row expands to the splits table. Ranked riders first, then a "Missing segments" group. The logged-in rider's row is pinned when off-screen.
- **Segments** (09e): the existing board, fed from the matrix, with the full rider list instead of top 10 and the per-segment stats; a checkbox column mirrors the picker.
- **Crown** (09e): the existing KOM-count table, computed from the matrix for the current selection. `get_segment_leaderboard` is dropped in a later migration once nothing calls it.
- Length slider: a two-thumb range built from two native `<input type="range">` (no dependency), keyboard accessible, values debounced into the URL.
- Phone width: presets and slider in the existing filter sheet; lanes stay tappable; tables scroll inside `.table-scroll`.
- "Hide my times" / "Show my times" link for the logged-in rider (P1), replacing the opt-in banner (09d).

## 8. Sub-phases

| PR | Content | Done when |
|---|---|---|
| **09a** Data foundations | Migration 051 (`segment_bests`, carry-over, ingest RPC, deletion trigger), curation lib, self-running backfill, DevTools: Curate, core chart, curation table. Fixtures: bests across two years, `along_*`, `in_core`, `selectable`, two duplicate segments, one overlapping pair. | Unit tests for de-duplication and the cap. Db tests: a ride with three laps of one segment stores one best with `effort_count = 3`; a slower later ride keeps the best and adds to the count; running the RPC twice on one ride changes nothing; a private ride stores nothing; deleting the best's ride removes the row and re-queues the rider's other rides from that year; the carry-over equals `DISTINCT ON` over the old table; the planner enqueues the sample first; a tick with 5 open jobs enqueues nothing. Goldens unchanged. In prod after deploy: Reclassify → Curate, then fetched rides rise daily without anyone pressing a button. |
| **09b** Bayway + HMBW | `suggestCorridorReference`, `fetchCorridorStreams`, two reference lines and profiles from the chosen medoid rides, migration 052, core ranges, tabs enabled. | Unit test: the medoid of a fixture with 5 similar lines and 1 detour is never the detour. Corridor tests pass for all three lines; a segment inside two lines' radius gets the corridor whose core contains it; sample backfill done and cores confirmed by Phillip. |
| **09c** Matrix + maths | Migration 053, `segment-cumulative.ts`, query model, server fn (one subrequest), query options. | Unit tests: `resolveChain` never returns overlapping bars and is deterministic; `cumulative` matches hand-computed fixture totals in `EXPECTED.json`; a rider with 7 of 10 segments is in `partial`. Db tests: hidden riders, private and hidden rides never appear in the JSON; the matrix call stays under 200 ms on 100 k rows. |
| **09d** Cumulative view + picker | Lanes as picker, presets, slider, table, stats cards, KOM honours, hide/show link. | Unit tests: a rider with 8 of 10 segments is ranked with two filled splits, one with 7 of 10 is in `partial`; `honour` gives `strava_kom` at exactly the KOM time and `former_kom` one second slower with `kom_rank = 1`. Component tests: clicking a lane toggles it and sets `set=custom`; the slider changes the count; "Remove overlaps" clears the warning; a Strava KOM holder's row shows the crown. E2E: `/segments` shows a ranked table, choosing "Climbs" changes the URL and the total. `[perf] fetchSegmentMatrix subreq=1`. |
| **09e** Segment and Crown views | Full per-segment boards and stats from the matrix. Migration drops `get_segment_leaderboard` and `segment_efforts`. | The fixture's per-segment leaders equal the phase 07 `EXPECTED.segments.leaders`; e2e expands a segment and sees "View on Strava". |
| **09f** Polish | Profile-page strip (the rider's totals and ranks on each route's core chain), PostHog events (`segments_viewed`, `segment_set_changed`, `segment_board_hidden`), runbook in `docs/ops/`. | Events visible in PostHog. |

Order: 09a first and deployed early, because the backfill takes about 16 days and everything else can be built against fixtures meanwhile. 09b and 09c can run in parallel after 09a; 09d needs 09c; 09e needs 09d.

## 9. Risks

- **Strava's terms on showing other athletes' data.** P1 relies on SF2G sign-up as the consent. Riders who joined before this feature agreed to "ride statistics"; the `/privacy` bullet (09a) and the "Hide my times" link cover the change. Every time keeps its "View on Strava" link.
- **Stale KOM crowns.** KOM times refresh every 7 days, so a crown can lag a week after someone takes the KOM. The tooltip shows when it was checked.
- **Filled times (P4).** Slowest + 10 % is a judgement call. If it feels unfair, the alternative is the segment's median; the setting is one constant.
- **Storage.** Bests only (P7): about 100 k rows, ~15 MB, growing by one row per rider, segment and year, not per ride.
- **Changing the selectable set later** is free: bests exist for every segment ridden. Only a change of granularity (years → months, P7a) or wanting per-effort history would need a refetch of every ride (~16 days).
- **Losing a best.** A deleted or newly private ride takes its best with it; P7b refetches that rider's rides for that year. If a bug in the ingest RPC corrupts bests, the fix is the same: clear `segment_efforts_fetched_at` for the affected rides and let the backfill run.
- **Small boards.** HMBW has 11 regular riders. With "every segment required" its ranked list may be short; the Core chain there should be 3–5 long segments.
- **Core ranges from a 14-rider sample.** Recheck the ride-share chart once 1,000 Skyline rides are in.
- **Strava terms.** No scraping, only connected riders' data; a Strava link on every time. Unchanged from phase 07.
- **Rate limit.** If 16 days is too slow, ask Strava for a higher limit; nothing in the design changes.

## 10. Out of scope

- A combined "triple crown" across the three routes (sum of the three core chains). Easy once the three matrices exist.
- Northbound boards for Bayway and HMBW.
- Real segment polylines on the map (07d).
- Riders who have not connected Strava: not possible (phase 07 §2).
