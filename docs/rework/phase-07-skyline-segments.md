# Phase 07 — Skyline segment leaderboard

Written 2026-10-24 by Claude (Fable 5.1). Three PRs (07a, 07b, 07c), one session each.
To implement: read this whole file, then `CLAUDE.md`, then `docs/rework/README.md` ("Rules every implementing agent follows"). Start with the sub-phase you were given and stop when its "Done when" list is green and the PR is open.

**Every decision below is made.** Where Phillip might later want something different it is marked `(default — Phillip may change)`. Implement the default; do not ask.

---

## 1. What we are building

A page `/segments` with two tables:

1. **Skyline crown** — one row per rider: how many Skyline segments they hold the fastest SF2G time on, podiums, points, average closeness to the KOM.
2. **Segment board** — one row per Skyline segment (climbs and flats only): the KOM time and the fastest SF2G rider; expanding a row shows the top 10 SF2G riders with "View on Strava" links.

Only riders who are connected to SF2G **and have opted in** appear. Data comes from each rider's own Strava activities (see §2). Later corridors (Bayway, HMBW) reuse all of this by adding one reference polyline each.

## 2. What Strava gives us (verified 2026-10-24 — do not look for alternatives)

| We need | Strava endpoint | Status |
|---|---|---|
| Everyone's times on a segment | `GET /segments/{id}/leaderboard` | **Removed in June 2020.** Does not exist. |
| Find segments in an area | `GET /segments/explore` | Extended Access Tier only. **Not available to this app.** |
| A rider's efforts on every segment in one of their rides | `GET /activities/{id}?include_all_efforts=true` | **Use this.** One read per ride. Returns `segment_efforts[]`; fields in §5.3. Scope `activity:read_all` (already required). |
| KOM / QOM time of a segment | `GET /segments/{id}` → `xoms: { kom: "4:49", qom: "5:40", overall: "4:49" }` | **Use this.** Strings, no holder name. Also `effort_count`, `athlete_count`. |
| Riders who are not connected | — | **Impossible.** No endpoint returns other athletes' times. Do not scrape strava.com (breaks the API Terms). |

Rate limits are per application: 100 reads / 15 min, 1,000 reads / day (`STRAVA_RATE_LIMIT` in `app/lib/constants.ts`). Normal sync uses ~300/day, so ~500 activity-detail reads/day are free for this feature. The drain already stops at 85 % of either bucket from the response headers; segment jobs inherit that.

Terms: the Strava API agreement (2024-11-11) allows showing a rider's data to other users only with explicit consent. Hence opt-in (§3) and a "View on Strava" link on every effort.

## 3. Decisions

| # | Decision | Value |
|---|---|---|
| D1 | Who appears on the board | Riders with `users.segment_board_opt_in = true`. Default `false`. (default — Phillip may change to opt-out) |
| D2 | Private rides | Efforts are stored but **excluded from ranking** (`rides.is_private = true`), matching Strava's own leaderboards. |
| D3 | Reference line for "on Skyline" | `SKYLINE_REFERENCE_POLYLINE` in §5.1 — the Skyline section of a real SF2G ride, Daly City gateway → Kings Mountain gateway, 26.6 km. |
| D4 | A segment is "on Skyline" | Both its start and end points are within **400 m** of the reference line (`SEGMENT_CORRIDOR_RADIUS_M = 400`). |
| D5 | Terrain | `average_grade >= 2` → `climb`; `-1 <= average_grade < 2` → `flat`; `< -1` → `descent`. Descents never show. Also hidden: `distance_meters < 300`, `hazardous = true`. |
| D6 | Direction | `end_lat < start_lat` → `south` (the morning SF→G direction), else `north`. Page default: `south`. |
| D7 | Minimum riders for a segment to show | 3 opted-in riders with an effort (`SEGMENT_MIN_RIDERS = 3`). |
| D8 | Rank | Dense rank of each rider's best `elapsed_time_seconds` on the segment (within the date filter). |
| D9 | Points | `Σ max(0, 11 − rank)` over segments shown. Crown sorts by `sf2g_koms` desc, then `points` desc, then `display_name`. |
| D10 | Which rides get fetched | Rides with `route_category = 'skyline'` (v1). Rides overridden to skyline via `ride_overrides` are not fetched in v1. |
| D11 | What is stored per fetched ride | **All** its efforts, on all segments (storage is cheap, the read is not). `segments.corridor` decides what the page shows. |
| D12 | Job priority | `segment_efforts` and `segment_xoms` sort after `backfill` in `claim_sync_jobs`; rider syncs never wait for them. |
| D13 | KOM refresh | `segment_xoms` for every corridor segment whose `xoms_fetched_at` is older than 7 days, at most 5 per tick. |
| D14 | Route | `/segments` with search params `corridor, terrain, direction, range, top` (§7). Nav link "Segments" after "Routes". |

## 4. Prerequisites

Phases 04 (job queue, `sync_jobs`, `claim_sync_jobs`, `enqueue_sync_job`), 05 (`DataTable`, `TableQuery`, `resolveDateRange`) and 06 are on the base branch. Local Supabase running (`pnpm db:start`), `.env.local` → `http://127.0.0.1:54321`. Never touch project `dgoqjrfjrzewplwayhhz`.

---

## 5. Specification

### 5.1 Constants — `app/lib/constants.ts` (07a)

```ts
/** Skyline Blvd, Daly City gateway → Kings Mountain gateway, from Strava activity 20662409258 (2026-10-20), 128 points, 26.6 km. */
export const SKYLINE_REFERENCE_POLYLINE =
  "ol|dFffrjVnGkGxBkDzJoRzNeOnGkJdB{Afe@qW~MkGhEQhXdD`CUlu@op@zFoF~B_DvRib@rGqJxDoElEaEbKyHpO{PxM{GlCmBblAwiAlIiFxi@kg@tT{Y`NqNJe@w@aBCw@fAoBbZwXrJeK`@GrAjBt@EjJmL|KkPdF}FdDeCrLuFNk@k@eEJkAnQwSdZgRtR_PzP{PpCiBnAkBfCgIvBiDv\\i]~JuIn\\_SdJmH~OgRb@cBVuF`@qAx@E~HtMd@JtU{Rt`@mRxJyArGmFfAe@nAFhExAdCCpAsAfA}EfFiHrEsAnE}CjJ{CRHPhCh@Rj@QfB}BzA}ALgAYuDJq@r@CzBtEn@FfDgFlC_@|@mClC]xC}DhI}DnBmCxHsFbZuXs@uHJiCj@cBvFeJhBoBtHqB`DsChBeDjAuEhEcGhGuQzAgC|DkCdFo@nBq@hDgDdAsC`@eC?qJ`@{EnAgEfBoCxBkB~Aq@~NoBnFgCjCwCjUm\\lDqD";

export const SEGMENT_CORRIDORS = {
  skyline: { label: "Skyline", polyline: SKYLINE_REFERENCE_POLYLINE },
} as const;
export type SegmentCorridor = keyof typeof SEGMENT_CORRIDORS;

export const SEGMENT_CORRIDOR_RADIUS_M = 400;
export const SEGMENT_MIN_RIDERS = 3;
export const SEGMENT_MIN_DISTANCE_M = 300;
export const SEGMENT_TERRAIN = { climbMinGrade: 2, flatMinGrade: -1 } as const;
```

Sanity values for tests: the decoded polyline starts at `[37.67, -122.48692]` and ends at `[37.48889, -122.32009]`; its latitude range is 37.489–37.670 and longitude −122.487 to −122.320.

### 5.2 Corridor logic — `app/lib/segment-corridor.ts` (07a, pure, no I/O)

```ts
export interface SegmentGeometry {
  start_latlng: [number, number];
  end_latlng: [number, number];
  average_grade: number;
}
/** Metres from a point to the nearest point on the polyline (point-to-segment, not point-to-vertex). */
export function distanceToPolylineMeters(point: [number, number], line: [number, number][]): number;
/** 'skyline' when both endpoints are within SEGMENT_CORRIDOR_RADIUS_M of that corridor's line, else null. Checks every corridor in SEGMENT_CORRIDORS. */
export function classifySegmentCorridor(seg: SegmentGeometry): SegmentCorridor | null;
export function segmentDirection(seg: SegmentGeometry): "south" | "north";
export function segmentTerrain(averageGrade: number): "climb" | "flat" | "descent";
/** "4:49" → 289, "1:02:11" → 3731, "59s"/""/null → null. */
export function parseXomTime(raw: string | null | undefined): number | null;
```

Decode the reference polylines once at module load with `decodePolyline` from `app/lib/polyline.ts`. Use the haversine already in `route-classifier.ts` (export it from there or copy the 15 lines; do not add a dependency). Point-to-segment distance: project in a local equirectangular frame (metres per degree lat = 111,320; per degree lng = 111,320 × cos(lat)) — accurate enough at 26 km.

### 5.3 Strava client — `app/lib/strava.ts` (07a)

```ts
export interface StravaSegmentSummary {
  id: number; name: string; activity_type: string;
  distance: number; average_grade: number; maximum_grade: number;
  elevation_high: number; elevation_low: number; climb_category: number;
  start_latlng: [number, number]; end_latlng: [number, number];
  private: boolean; hazardous: boolean;
}
export interface StravaSegmentEffort {
  id: number; elapsed_time: number; moving_time: number;
  start_date: string; start_date_local: string; distance: number;
  kom_rank: number | null; pr_rank: number | null;
  average_watts?: number; device_watts?: boolean;
  segment: StravaSegmentSummary;
}
export interface StravaActivityDetail extends StravaActivitySummary { segment_efforts?: StravaSegmentEffort[] }
export interface StravaSegmentDetail extends StravaSegmentSummary {
  effort_count: number; athlete_count: number;
  xoms?: { kom?: string; qom?: string; overall?: string };
}
export async function fetchActivityDetail(accessToken: string, activityId: number): Promise<{ activity: StravaActivityDetail; response: RateLimitedResponse }>;
// GET /activities/{id}?include_all_efforts=true
export async function fetchSegment(accessToken: string, segmentId: number): Promise<{ segment: StravaSegmentDetail; response: RateLimitedResponse }>;
// GET /segments/{id}
```

Both go through `fetchWithRateLimit`, log like the existing functions, and throw `Strava API error (404): …` on 404 exactly as `fetchSingleActivity` does (the ingest step matches on `"(404)"`). Never persist the raw response (same TOS note as `activityToRideInsert`).

### 5.4 Migration `supabase/migrations/043_segments.sql` (07a)

Header: "Deploy order: apply this migration before deploying the Worker that contains 07a; the trigger only inserts job kinds the migration adds."

```sql
-- 1. Tables
CREATE TABLE segments (
  id               bigint PRIMARY KEY,          -- Strava segment id
  name             text NOT NULL,
  distance_meters  real NOT NULL,
  average_grade    real NOT NULL,
  maximum_grade    real,
  elevation_high   real,
  elevation_low    real,
  climb_category   smallint,
  start_latlng     jsonb NOT NULL,              -- [lat, lng]
  end_latlng       jsonb NOT NULL,
  hazardous        boolean NOT NULL DEFAULT false,
  corridor         text CHECK (corridor IN ('skyline')),
  direction        text NOT NULL CHECK (direction IN ('south', 'north')),
  terrain          text GENERATED ALWAYS AS (
                     CASE WHEN average_grade >= 2 THEN 'climb'
                          WHEN average_grade >= -1 THEN 'flat'
                          ELSE 'descent' END) STORED,
  kom_seconds      int,
  qom_seconds      int,
  overall_seconds  int,
  effort_count     int,
  athlete_count    int,
  xoms_fetched_at  timestamptz,
  curated_rank     int,                         -- admin: order in the "core" section; NULL = not core
  hidden           boolean NOT NULL DEFAULT false,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_segments_corridor ON segments (corridor) WHERE corridor IS NOT NULL;

CREATE TABLE segment_efforts (
  id                   bigint PRIMARY KEY,      -- Strava effort id
  segment_id           bigint NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id              uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  elapsed_time_seconds int NOT NULL,
  moving_time_seconds  int,
  start_date           timestamptz NOT NULL,
  kom_rank             smallint,
  pr_rank              smallint,
  average_watts        real,
  device_watts         boolean
);
CREATE INDEX idx_segment_efforts_rank ON segment_efforts (segment_id, user_id, elapsed_time_seconds);
CREATE INDEX idx_segment_efforts_ride ON segment_efforts (ride_id);
CREATE INDEX idx_segment_efforts_user ON segment_efforts (user_id);

ALTER TABLE rides ADD COLUMN segment_efforts_fetched_at timestamptz;
CREATE INDEX idx_rides_segment_pending ON rides (start_date DESC)
  WHERE route_category = 'skyline' AND segment_efforts_fetched_at IS NULL;
ALTER TABLE users ADD COLUMN segment_board_opt_in boolean NOT NULL DEFAULT false;

-- 2. RLS: segments public; segment_efforts only via the RPC (07b)
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read segments" ON segments FOR SELECT USING (true);
ALTER TABLE segment_efforts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON segment_efforts FROM anon, authenticated;
GRANT ALL ON segments, segment_efforts TO service_role;
-- users.segment_board_opt_in: add it to the column-level anon/authenticated SELECT grant from migration 036
-- (it is public, non-secret) AND to PUBLIC_USER_COLUMNS in app/lib/public-user.ts.

-- 3. Job kinds
ALTER TABLE sync_jobs DROP CONSTRAINT sync_jobs_kind_check;
ALTER TABLE sync_jobs ADD CONSTRAINT sync_jobs_kind_check CHECK (kind IN (
  'webhook_activity','incremental','backfill','deauthorize','refresh_views','recompute_groups',
  'segment_efforts',   -- payload: { ride_id }
  'segment_xoms'       -- payload: { segment_id }, user_id = whose token to use
));
CREATE UNIQUE INDEX uq_sync_jobs_open_segment_ride ON sync_jobs ((payload->>'ride_id'))
  WHERE status IN ('queued','running') AND kind = 'segment_efforts';
CREATE UNIQUE INDEX uq_sync_jobs_open_segment_xoms ON sync_jobs ((payload->>'segment_id'))
  WHERE status IN ('queued','running') AND kind = 'segment_xoms';
-- claim_sync_jobs: CREATE OR REPLACE with the ORDER BY CASE extended:
--   … WHEN 'backfill' THEN 3 WHEN 'segment_efforts' THEN 4 WHEN 'segment_xoms' THEN 5 ELSE 6 END

-- 4. Enqueue on new Skyline rides
CREATE FUNCTION enqueue_segment_efforts_for_ride() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM enqueue_sync_job('segment_efforts', NEW.user_id, jsonb_build_object('ride_id', NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rides_segment_efforts
  AFTER INSERT OR UPDATE OF route_category ON rides
  FOR EACH ROW
  WHEN (NEW.route_category = 'skyline' AND NEW.segment_efforts_fetched_at IS NULL)
  EXECUTE FUNCTION enqueue_segment_efforts_for_ride();
-- Re-upserts of an unfetched ride hit the unique index and are ignored (enqueue_sync_job returns false).

-- 5. Planners (service role only, like enqueue_due_syncs)
CREATE FUNCTION enqueue_segment_backfill(p_limit int DEFAULT 500) RETURNS int …
  -- rides WHERE route_category='skyline' AND segment_efforts_fetched_at IS NULL
  -- ORDER BY (SELECT segment_board_opt_in FROM users u WHERE u.id = r.user_id) DESC, r.start_date DESC
  -- LIMIT p_limit; count successful enqueue_sync_job calls.
CREATE FUNCTION enqueue_due_segment_xoms(p_older_than interval DEFAULT '7 days', p_limit int DEFAULT 5) RETURNS int …
  -- segments WHERE corridor IS NOT NULL AND NOT hidden AND (xoms_fetched_at IS NULL OR xoms_fetched_at < now() - p_older_than)
  -- ORDER BY xoms_fetched_at NULLS FIRST LIMIT p_limit;
  -- user_id = (SELECT id FROM users WHERE NOT needs_reauth AND deauthorized_at IS NULL AND strava_refresh_token <> ''
  --            ORDER BY last_sync_success_at DESC NULLS LAST LIMIT 1)
REVOKE EXECUTE ON FUNCTION enqueue_segment_backfill(int), enqueue_due_segment_xoms(interval, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_segment_backfill(int), enqueue_due_segment_xoms(interval, int) TO service_role;
```

### 5.5 Ingest — `app/server/segments-ingest.ts` (07a)

```ts
export type SegmentEffortsOutcome = "efforts_stored" | "ride_not_found" | "ride_missing";
/** One segment_efforts job step: 1 Strava read + ≤ 3 Supabase calls. */
export async function segmentEffortsStep(rideId: string, supabase: ServiceClient): Promise<{ outcome: SegmentEffortsOutcome; efforts: number; segments: number }>;
/** One segment_xoms job step: 1 Strava read + 1 Supabase update. */
export async function segmentXomsStep(segmentId: number, userId: string, supabase: ServiceClient): Promise<{ updated: boolean }>;
export function effortToInsert(userId: string, rideId: string, e: StravaSegmentEffort): SegmentEffortInsert;
export function segmentToUpsert(s: StravaSegmentSummary): SegmentInsert;   // fills corridor + direction via segment-corridor.ts
```

`segmentEffortsStep` in order:
1. `SELECT id, user_id, strava_activity_id FROM rides WHERE id = rideId` (call 1). Missing → `ride_missing`, done.
2. `ensureValidToken(user_id)` (0–1 Strava calls; the refresh is not a "read").
3. `fetchActivityDetail` (the 1 read). 404 → set `segment_efforts_fetched_at = now()` and return `ride_not_found`.
4. Upsert `segments` (`onConflict: "id"`, never overwrite `curated_rank`, `hidden`, `kom_seconds…` — select only the summary columns in the upsert object) (call 2).
5. Upsert `segment_efforts` (`onConflict: "id"`) (call 3). Skip efforts whose `segment.activity_type !== "Ride"`.
6. `UPDATE rides SET segment_efforts_fetched_at = now()` (call 4 — so the budget is 1 Strava + 4 Supabase; put the rides SELECT and UPDATE together by selecting in step 1 and updating in step 6; acceptable at ≤ 5 subrequests, log it with `logPerf`).
   Newly seen corridor segments get `enqueue_sync_job('segment_xoms', user_id, {segment_id})` only when `xoms_fetched_at IS NULL` — do this in the same upsert round-trip by selecting `id, xoms_fetched_at` back from the segments upsert (`.select()`), then one `enqueue_sync_job` RPC per new corridor segment capped at 3 per step (the weekly planner catches the rest).

`sync-drain.ts` — add to `runJob`:
```ts
case "segment_efforts": { const r = await segmentEffortsStep(String(job.payload.ride_id), supabase);
  return { status: "done", detail: `${r.outcome}: ${r.efforts} efforts`, ridesChanged: false }; }
case "segment_xoms":    { const r = await segmentXomsStep(Number(job.payload.segment_id), job.user_id!, supabase);
  return { status: "done", detail: r.updated ? "xoms updated" : "no xoms", ridesChanged: false }; }
```
`DRAIN_BUDGET.PER_JOB_HEADROOM` (10) already covers these. `scheduled.ts`: after `enqueue_due_syncs`, call `enqueue_due_segment_xoms` (one extra subrequest per tick).

### 5.6 Admin — `app/server/segments-admin.ts` (07a)

```ts
export const enqueueSegmentBackfill = createServerFn({ method: "POST" })
  .validator((d: { limit?: number }) => d)
  .handler(async ({ data }) => { await assertAdmin(); /* rpc enqueue_segment_backfill */ return { enqueued: n }; });
export const fetchSegmentIngestStats = createServerFn({ method: "GET" }).handler(async () => { await assertAdmin();
  /* one RPC or 3 counts: rides pending/fetched, segments (corridor / total), efforts, open segment jobs */ });
```
DevTools panel: a "Segments" section showing the stats and a "Backfill segment efforts" button with a number input (default 500). Follow `handleCronJobs` (dynamic import of the server fn, result in the panel).

### 5.7 RPC `get_segment_leaderboard(q jsonb) RETURNS jsonb` — `044_get_segment_leaderboard.sql` (07b)

`LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`; `REVOKE EXECUTE … FROM PUBLIC; GRANT EXECUTE … TO anon, authenticated, service_role`. It is the **only** read path to `segment_efforts`.

Input keys of `q` (all optional; TS validates before calling):

| key | type | default |
|---|---|---|
| `corridor` | `'skyline'` | `'skyline'` |
| `terrain` | `'all' \| 'climb' \| 'flat'` | `'all'` |
| `direction` | `'south' \| 'north' \| 'both'` | `'south'` |
| `date_from`, `date_to` | `YYYY-MM-DD` or null | null (all time) — resolved from the URL preset in TS with `resolveDateRange` |
| `top` | int 1–50 | 10 |
| `min_riders` | int | 3 |

CTEs, in order:
1. `eligible_efforts`: `segment_efforts e JOIN rides r ON r.id = e.ride_id JOIN users u ON u.id = e.user_id JOIN segments s ON s.id = e.segment_id` WHERE `u.segment_board_opt_in AND u.deauthorized_at IS NULL AND NOT r.is_private AND s.corridor = q.corridor AND NOT s.hidden AND s.terrain <> 'descent' AND s.distance_meters >= 300 AND NOT s.hazardous AND (terrain filter) AND (direction filter) AND (date filter on r.ride_date)`.
2. `best`: per `(segment_id, user_id)`: `MIN(elapsed_time_seconds)`, the `start_date`, `ride_id` and `strava_activity_id` of that effort (use `DISTINCT ON (segment_id, user_id) … ORDER BY segment_id, user_id, elapsed_time_seconds, start_date`), `COUNT(*) AS effort_count`, `MIN(kom_rank) AS kom_rank`.
3. `ranked`: `DENSE_RANK() OVER (PARTITION BY segment_id ORDER BY best_seconds)` and `COUNT(*) OVER (PARTITION BY segment_id) AS rider_count`; keep segments with `rider_count >= q.min_riders`.
4. `segment_json`: per segment, `jsonb_agg` of the top `q.top` riders ordered by rank, with `pct_of_kom = round(coalesce(s.overall_seconds, s.kom_seconds)::numeric / best_seconds, 3)` (null when no xoms).
5. `crown`: per user over `ranked`: `sf2g_koms = count(*) FILTER (WHERE rank = 1)`, `podiums = count(*) FILTER (WHERE rank <= 3)`, `strava_top10s = count(*) FILTER (WHERE kom_rank IS NOT NULL)`, `segments_ridden = count(*)`, `points = sum(greatest(0, 11 - rank))`, `mean_pct_of_kom = avg(pct_of_kom)`, then `rank` by (`sf2g_koms` desc, `points` desc, `display_name`).

Output:
```json
{ "corridor": "skyline", "segments_total": 17,
  "segments": [ { "id": 1, "name": "…", "distance_meters": 1830, "average_grade": 5.1, "terrain": "climb", "direction": "south",
                  "kom_seconds": 289, "qom_seconds": 340, "curated_rank": null, "rider_count": 12,
                  "riders": [ { "user_id": "…", "display_name": "…", "avatar_url": "…", "best_seconds": 301, "best_date": "2026-03-05",
                                "strava_activity_id": 17614755881, "rank": 1, "pct_of_kom": 0.96, "kom_rank": 7, "effort_count": 14 } ] } ],
  "crown": [ { "user_id": "…", "display_name": "…", "avatar_url": "…", "rank": 1, "sf2g_koms": 5, "podiums": 9, "strava_top10s": 2,
               "segments_ridden": 15, "segments_total": 17, "points": 118, "mean_pct_of_kom": 0.91 } ] }
```
Segments are ordered `curated_rank NULLS LAST, rider_count DESC, name`. The user fields are exactly `user_id, display_name, avatar_url` — nothing else from `users` leaves the function.

### 5.8 Query model, server fn, page (07b)

- `app/lib/segment-query.ts`: zod schema `SegmentQuery` `{ corridor: 'skyline'; terrain: 'all'|'climb'|'flat'; direction: 'south'|'north'|'both'; range: DatePreset (reuse the preset type from table-query.ts, default 'all'); top: 10 }`, `parseSegmentSearch(raw)` (every field `.catch()`es its default), `serializeSegmentSearch(q)` (drops defaults), `toSegmentSqlParams(q, now)` (resolves `range` → `date_from/date_to` with `resolveDateRange`).
- `app/server/segments.ts`: `fetchSegmentLeaderboardImpl(input)` → one `supabase.rpc('get_segment_leaderboard', { q })` on the anon client, wrapped in `withPerf("fetchSegmentLeaderboard", …)`; `fetchSegmentLeaderboard = createServerFn({ method: "GET" }).validator(parseSegmentSearch).handler(…)`. `setSegmentBoardOptIn = createServerFn({ method: "POST" })`: requires `getSessionData()`, updates only that user's row with the service client, returns `{ optIn }`. Extend `getCurrentUser` (`auth.ts`) to include `segment_board_opt_in` (it is in `PUBLIC_USER_COLUMNS` after 07a).
- `app/queries/segments.ts`: `segmentLeaderboardQueryOptions(params)` keyed `['segments', params]`, `staleTime` 5 min, like `leaderboardQueryOptions`.
- `app/routes/segments.tsx`: `validateSearch: parseSegmentSearch`; `head()` title "Skyline Segments — SF2G"; loader prefetches the query; renders `<SegmentFilters>` (FilterChips for terrain and direction, the date preset select used on the leaderboard), `<SegmentOptInBanner>` (only for a logged-in user with `segment_board_opt_in = false`), `<SegmentCrownTable>` then `<SegmentBoard>`.
- `app/components/SegmentCrownTable.tsx`: `DataTable` with columns Rider (avatar + name, link to profile), SF2G KOMs, Podiums, Points, Avg % of KOM, Coverage (`segments_ridden/segments_total`), Strava top-10s. Client-side sort via `useDataTable`.
- `app/components/SegmentBoard.tsx`: `DataTable` rows = segments: Segment (name; distance and grade under it), Terrain, KOM, SF2G leader (avatar + name + time), % of KOM, Riders. Clicking a row toggles an inline list of its `riders` with rank, time, date, and an `<a href="https://www.strava.com/activities/{id}" target="_blank" rel="noopener">View on Strava</a>`.
- `app/styles/segments.css`; mobile: tables scroll horizontally inside `.table-scroll` like the leaderboard; chips collapse into the existing filter sheet pattern.
- `NavBar.tsx`: add `{ to: '/segments', label: 'Segments' }` after Routes.

### 5.9 Fixtures — `scripts/gen-fixtures.ts` (07a), read by every db test

Add, deterministically:
- Set `segment_board_opt_in = true` for riders 1–6; false for 7–9.
- 8 segments with ids 900001–900008 whose start/end points are **sampled from the decoded `SKYLINE_REFERENCE_POLYLINE`** (import the constant; take points at indices e.g. 5→20, 25→40, …) so the corridor test is real geometry:
  - 900001–900003: climbs (grades 4, 6, 3), south.
  - 900004–900005: flats (grades 0.5, −0.5), south.
  - 900006: descent (grade −4), south — must never appear.
  - 900007: climb, **north** (swap start/end) — appears only with `direction=north|both`.
  - 900008: climb, south, endpoints offset 2 km east of the line → `corridor = NULL` — must never appear.
- Efforts: for each of 900001–900005 and 900007, 3–6 opted-in riders with distinct best times (no ties), several efforts each (the best is not the first), one effort from rider 7 (opted out) that is **faster than everyone** on 900001, and one effort on 900002 from a ride with `is_private = true` that is faster than everyone. 900004 gets only 2 riders (below `SEGMENT_MIN_RIDERS`).
- Every fixture ride gets `segment_efforts_fetched_at = fixtureNow` so the seed does not enqueue jobs.
- `kom_seconds` on 900001–900003 (so `pct_of_kom` is testable), null on the rest; `xoms_fetched_at = fixtureNow` where set.
- `EXPECTED.json.segments`: `{ shown: [ids in display order for default filters], leaders: { "900001": { userId, seconds } … }, riderCounts, crown: [ { userId, koms, podiums, points } … in order ] }`, computed in the script with plain loops.

**As built in 07a (read before 07b):**
- The opted-out rider who is fastest on 900001 is **rider 9 (Ivy)**, not rider 7: Gus has no rides, and every effort needs a ride. `EXPECTED.segments.optedOutRider` holds the id.
- The seed has **no private ride**: private rides count toward a rider's total distance and their own ride list, so adding one moved existing goldens. 07b's test inserts its own private ride and a faster 900002 effort for an opted-in rider (throwaway-row pattern from `segments-ingest.test.ts`) and deletes them afterwards.
- Also in `EXPECTED.segments`: `pctOfKom` (900001–900003), `north` and `both` (shown ids for those directions), and `window: { date_from: "2025-01-01", date_to: "2025-12-31", leaders }`. Within that window the 900003 leader changes (rider 5 → rider 3).
- Segment step results carry `rateLimited`. When a finished step's Strava response is near the limit, the drain stops starting jobs for that tick (`JobOutcome.rateLimited`).
- `segment_ingest_stats()` (service role) backs `fetchSegmentIngestStats` in a single call.

---

## 6. Sub-phase 07a — data layer

**Files:** `supabase/migrations/043_segments.sql`, `app/lib/constants.ts`, `app/lib/segment-corridor.ts`, `app/lib/public-user.ts`, `app/lib/strava.ts`, `app/server/segments-ingest.ts`, `app/server/segments-admin.ts`, `app/server/sync-drain.ts`, `app/server/scheduled.ts`, `app/components/DevToolsPanel.tsx`, `app/test/strava-mock.ts`, `scripts/gen-fixtures.ts`, `supabase/seed/*` (generated), `app/lib/database.types.ts` (generated), tests below.

**Steps, in order:**
1. Write the failing unit tests `app/lib/__test__/segment-corridor.test.ts`:
   - reference polyline decodes to 128 points, first `[37.67, -122.48692]`, last `[37.48889, -122.32009]`;
   - a segment from point 10 to point 30 of the line → `'skyline'`, `'south'`; reversed → `'north'`;
   - the same segment with its end moved 2 km east → `null`; moved 300 m east → `'skyline'`;
   - `segmentTerrain(2) = 'climb'`, `(1.99) = 'flat'`, `(-1) = 'flat'`, `(-1.01) = 'descent'`;
   - `parseXomTime` cases from §5.2.
2. Implement §5.1 and §5.2 until green.
3. Write the migration (§5.4). `pnpm db:reset` must succeed. `pnpm db:types`.
4. Add `segment_board_opt_in` to `PUBLIC_USER_COLUMNS` and the migration-036 column grant (in 043).
5. Extend `app/test/strava-mock.ts`: `MockActivity.segment_efforts?: StravaSegmentEffort[]`; `GET /api/v3/activities/{id}` returns the activity including `segment_efforts` when `include_all_efforts=true`; `opts.segments?: Record<number, Partial<StravaSegmentDetail>>` served at `GET /api/v3/segments/{id}` (404 when absent).
6. Write the failing db tests `app/server/__test__/db/segments-ingest.test.ts` (copy the `TEST_USER` pattern from `sync-queue.test.ts`; insert a throwaway skyline ride for that user with `segment_efforts_fetched_at` NULL — note the trigger will enqueue a job for it, which is one of the assertions):
   - inserting the ride creates exactly one `segment_efforts` job with `payload.ride_id`; inserting a `bayway` ride creates none; updating a `bayway` ride to `skyline` creates one; re-upserting the same unfetched ride creates no second job;
   - `claim_sync_jobs(10)` returns a queued `backfill` job before a queued `segment_efforts` job;
   - `segmentEffortsStep` on a mocked detail with 5 efforts (3 on corridor segments sampled from the reference line, 1 off-corridor, 1 on a `Run` segment) → 4 `segments` rows (the Run one skipped), 4 `segment_efforts` rows, corridor set on 3, `rides.segment_efforts_fetched_at` set, `mockStrava().calls` contains exactly one `/api/v3/activities/<id>?include_all_efforts=true`; running it again changes no row counts;
   - a 404 detail → `ride_not_found`, `segment_efforts_fetched_at` set, zero rows;
   - `segmentXomsStep` with `xoms: { kom: "4:49", qom: "5:40", overall: "4:49" }` → `kom_seconds = 289`, `qom_seconds = 340`, `overall_seconds = 289`, `xoms_fetched_at` set; with no `xoms` → `updated: false` but `xoms_fetched_at` still set (so it is not retried every tick);
   - `enqueue_segment_backfill(1)` enqueues the newest pending skyline ride of an opted-in rider first; `enqueue_due_segment_xoms` enqueues corridor segments with stale `xoms_fetched_at` and a `user_id` that has a token;
   - `runJob` for both kinds returns `status: "done"`.
   If an existing `sync-queue.test.ts` job count changes, it is because a synthetic ride classified as `skyline`; assert on job kinds there instead of totals.
7. Implement §5.3, §5.5, the two `runJob` cases, the `scheduled.ts` call, §5.6 and the DevTools section until green.
8. Fixtures (§5.9): `pnpm fixtures`, `pnpm db:reset`, then `pnpm test:db` — the existing goldens must not change (segments add rows to new tables only; `segment_efforts_fetched_at` is not read by any existing function).
9. `pnpm typecheck && pnpm test && pnpm test:db`. Commit (prettier runs on commit; typecheck + tests on push). Open the PR; include the migration deploy-order note and the Strava facts table's first two rows in the description so reviewers know why there is no leaderboard call.

**Done when:**
- [ ] All tests in step 1 and 6 pass; `pnpm test:db` green with unchanged goldens.
- [ ] `grep -rn "select(\"\*\")" app/server/segments-*.ts` → nothing; no `users` columns beyond `PUBLIC_USER_COLUMNS` are returned by any new server fn.
- [ ] Local manual check with MSW off (`pnpm dev`, logged in with your real Strava): DevTools → "Backfill segment efforts" with limit 3, then "Run queue tick" twice; `/rest/v1/segment_efforts` has rows; a `[perf] segment_efforts subreq=…` line shows ≤ 5.
- [ ] PR open, one phase, no `.env*.local` committed.

## 7. Sub-phase 07b — the board

**Files:** `supabase/migrations/044_get_segment_leaderboard.sql`, `app/lib/segment-query.ts`, `app/server/segments.ts`, `app/server/auth.ts` (opt-in on `getCurrentUser`), `app/queries/segments.ts`, `app/routes/segments.tsx`, `app/components/SegmentCrownTable.tsx`, `SegmentBoard.tsx`, `SegmentFilters.tsx`, `SegmentOptInBanner.tsx`, `app/styles/segments.css`, `app/components/NavBar.tsx`, `e2e/pages.spec.ts`, tests below.

**Steps, in order:**
1. Failing db test `app/server/__test__/db/segments-board.test.ts` against the fixtures:
   - default `q` (`south`, `all`, all time) → `segments` ids equal `EXPECTED.segments.shown`; each segment's `riders[0]` equals `EXPECTED.segments.leaders[id]`; `rider_count` equals `EXPECTED.segments.riderCounts[id]`;
   - rider 7 (opted out) appears nowhere in the JSON (stringify and `expect(json).not.toContain(rider7Id)`), even though they hold the fastest time on 900001;
   - the private-ride effort on 900002 is not the leader;
   - 900004 (2 riders), 900006 (descent), 900008 (off corridor) are absent; 900007 absent by default, present with `direction: 'north'` and `'both'`;
   - `terrain: 'climb'` returns only 900001–900003 (+900007 when `both`);
   - `date_from/date_to` covering only the fixture's second year changes the leader of 900003 as the fixture plans;
   - `crown` order and numbers equal `EXPECTED.segments.crown`; `pct_of_kom` for the 900001 leader equals `round(kom/best, 3)`;
   - `top: 2` returns at most 2 riders per segment while `rider_count` is unchanged;
   - calling the RPC as `anon` works; `SELECT * FROM segment_efforts` as `anon` is denied.
2. Write migration 044 (§5.7) until green. `pnpm db:types`.
3. Unit tests `app/lib/__test__/segment-query.test.ts`: `parseSegmentSearch({})` gives defaults; garbage values fall back; `serializeSegmentSearch` drops defaults; `toSegmentSqlParams` resolves `range: 'thisYear'` to LA-time dates.
4. Implement §5.8. Component test `app/components/__test__/SegmentCrownTable.test.tsx`: renders the fixture crown, click "Points" header sorts desc.
5. `e2e/pages.spec.ts`: add `/segments` to the rendered-pages matrix (no console errors, no hydration errors); one test: click the "Climbs" chip → URL contains `terrain=climb` and the board has fewer rows than before.
6. `pnpm typecheck && pnpm test && pnpm test:db && pnpm e2e`. PR.

**Done when:**
- [ ] Step 1–5 tests green; goldens unchanged.
- [ ] `[perf] fetchSegmentLeaderboard subreq=1` on every load.
- [ ] A logged-out visit to `/segments` and a logged-in visit as an opted-out rider both show the same riders; the opted-out rider sees the banner; clicking it flips `segment_board_opt_in` and they appear after refetch.
- [ ] Phone width: no horizontal page scroll, tables scroll inside their container.

## 8. Sub-phase 07c — polish

**Files:** `app/components/SegmentMap.tsx` (lazy Leaflet, reference line + segment start markers, click → scroll to row; same tiles/attribution as `/routes`), DevTools curation (`setSegmentCuration({ id, curated_rank, hidden })`, `assertAdmin()`), profile page strip (`fetchRiderSegmentSummary(userId)`: one RPC `get_rider_segment_summary(p_user_id)` returning koms/podiums/best rank, only when the rider is opted in), `CopyLinkButton` on `/segments`, PostHog events `segments_viewed` (with filters) and `segment_board_opt_in`.

Tests: curation changes the RPC output (hidden segment disappears, curated one moves first); profile summary returns null for an opted-out rider; e2e: map renders without tile errors.

**Done when:** tests green; every corridor segment in prod has `xoms_fetched_at` within 8 days after a week (Phillip checks).

---

## 9. Rules specific to this phase

- Never call Strava from a request handler; only the drain steps do. Never loop over rides in a server fn.
- Never `select("*")` on `users`; the RPC returns only `user_id, display_name, avatar_url`.
- `segment_efforts` has no anon policy — do not add one. Everything public goes through `get_segment_leaderboard`.
- Do not add a dependency for geometry; the project already has `decodePolyline` and a haversine.
- Do not store raw Strava responses (`strava_raw` is retired).
- Changing a fixture golden needs a sentence in the PR.
- Keep the three PRs separate; 07b must not touch ingest files except to add the opt-in read on `getCurrentUser`.

## 10. Verification commands

```bash
pnpm db:start && pnpm db:reset
pnpm test -- segment
pnpm test:db -- segments
pnpm dev            # DevTools → Segments → Backfill (limit 3) → Run queue tick
pnpm e2e
```

## 11. Risks

- **TOS / consent**: opt-in, per-rider cascade delete on deauthorize, Strava links on efforts. If Strava objects, restrict the RPC to the session user's own rows; the data model stays.
- **`kom_rank` availability** varies by subscription; it is decoration (`strava_top10s`) and never affects rank.
- **Backfill time**: 5–10k Skyline rides at ~500/day ≈ 10–20 days; newest first makes the page useful on day one. Phillip measures the real count with (read-only): `SELECT count(*) FROM rides WHERE route_category='skyline'`.
- **Reference line coverage**: segments on a Skyline variant the reference ride did not take (e.g. a Sawyer Camp detour) get `corridor = NULL`. Fix = add the variant as a second corridor polyline and run `UPDATE segments SET corridor = …` from a one-off admin action; efforts are never refetched.
- Rollback: revert the PR; tables and job kinds are inert without the drain cases.

## 12. Out of scope

- Riders who are not connected: not possible (§2). The board shows "N SF2G riders" per segment and the opt-in banner is the growth loop.
- Rides classified `other` that still ride Skyline (weekend loops): v1.1 — run the corridor test on the ride's own polyline before enqueueing.
- Bayway / HMBW boards: add a polyline to `SEGMENT_CORRIDORS`, widen the `corridor` CHECK, re-run corridor classification over `segments`.
