# Phase 07c — Skyline route view

Written 2026-10-25 by Claude (Fable 5.1) from Phillip's brief: "like Strava's activity page, but for the core Skyline route". Replaces the old §8 of `phase-07-skyline-segments.md`; the pieces it does not cover (curation, profile strip, PostHog, copy-link) move to 07d (§9 below).
To implement: read `phase-07-skyline-segments.md` (§3 decisions, §5.9 and the two "As built" notes), then this file, then `CLAUDE.md`. Base branch: 07b (`claude/phase-07b-segment-board-549fee`, PR #28) until it merges.

**Every decision below is made.** Items marked `(Phillip confirms)` need one answer from Phillip before that step; everything else is implemented as written.

---

## 1. What we are building

`/segments` gets a route view above the two tables:

```
┌ [Skyline]  [Bayway ·soon]  [HMBW ·soon] ─────────────────────────────┐  route tabs
│                                                                       │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │  Leaflet map: the route line, every shown segment drawn on it │   │  map
│   │  (hovered/selected segment in orange, marker follows hover)   │   │
│   └───────────────────────────────────────────────────────────────┘   │
│   2,000 ft ┤        ╱╲                                                │
│   1,000 ft ┤  ╱╲   ╱  ╲      ╱╲        ╱╲╲                            │  elevation profile
│       0 ft ┼─╯──╲─╯────╲────╯──╲──────╯───╲──────────────────────     │
│            0      5      10     15     20     25     30     35 mi      │
│   Segments ▓▓▓▓  ▓▓▓▓▓▓▓▓  ▓▓   ▓▓▓▓▓▓▓    ▓▓▓▓▓▓▓▓  ▓▓▓▓              │  segment lanes
│              ▓▓▓▓▓    ▓▓▓▓▓▓      ▓▓▓▓▓▓▓▓▓▓    ▓▓▓                   │  (packed rows,
│                 ▓▓        ▓▓▓▓                                        │   like Strava)
├───────────────────────────────────────────────────────────────────────┤
│  filters · opt-in banner · Skyline crown · Segment board (07b, as is) │
└───────────────────────────────────────────────────────────────────────┘
```

- The **route** is the core Skyline line: bottom of Mussel Rock → Arastradero Rd (§3.1).
- The **segments** drawn are exactly the ones the board shows for the current filters (same `get_segment_leaderboard` call, no second request).
- Hovering a bar, a map line or a board row highlights that segment everywhere; clicking a bar or map line expands its board row and scrolls to it.
- Tabs come from `SEGMENT_CORRIDORS`; a corridor without a polyline renders as a disabled "soon" tab. (default — Phillip may hide them)

## 2. Decisions

| # | Decision | Value |
|---|---|---|
| C1 | Route extent | Mussel Rock (Daly City) → Arastradero Rd. Replaces the 26.6 km Daly City → Kings Mountain line everywhere (`SKYLINE_REFERENCE_POLYLINE`), so segment classification (D4) covers the whole core route. End coordinate `(Phillip confirms)`: the point where the SF2G Skyline route turns onto Arastradero Rd. |
| C2 | Source of the route geometry and elevation | Strava streams (`distance, altitude, latlng`) of **one** real ride that covers the whole extent — activity 20662409258 if it does, else another of Phillip's `(Phillip confirms)`. Fetched **once** by a local script; committed as a static JSON (§3.2). No table, no request-time Strava call. |
| C3 | Where a segment sits on the profile | Along-track distance of its start and end point projected onto the route (`projectOntoPolyline`, §3.3), computed **in the browser** from `start_latlng`/`end_latlng`, which the RPC starts returning. No new columns. |
| C4 | Segment shape on the map | The slice of the route line between the segment's two along-track positions (segments are within 400 m of the route by definition). Real segment polylines (`GET /segments/{id}` → `map.polyline`) are a later nicety, not v1. |
| C5 | Direction (replaces D6) | `along(end) > along(start)` → `south`, else `north`. The old `end_lat < start_lat` rule breaks on the east-heading tail (Alpine/Arastradero). Applied at ingest and by the reclassification in §3.4. |
| C6 | Elevation chart | Hand-written SVG (one linear x-scale shared by the profile and the lanes, hover crosshair). Not Recharts: the lanes must align with the axis to the pixel, and Recharts gives no clean way to put custom rows under its plot. No new dependency. |
| C7 | Lane packing | Greedy by start: each bar goes in the first lane whose last bar ends before it starts. All lanes render (typically ≤ 8). |
| C8 | Segment colours | Climb and flat get two neutral tones from the theme; hovered/selected = `--color-sf2g-orange`. No per-rider colouring in v1. |
| C9 | Map | Leaflet, lazy, same tiles/attribution as `/routes` (`map-tiles.ts`), `fitBounds` to the route, zoom/scroll enabled, 320 px tall (220 px under 768 px). |
| C10 | Mobile | Map and profile fit the viewport width (no horizontal scroll); lanes are 6 px tall; tap = select. The tables below keep their 07b behaviour. |
| C11 | Reclassification after C1 | Existing `segments` rows get `corridor` and `direction` recomputed by an admin action (§3.4). Efforts are never refetched. |

## 3. Data

### 3.1 Route geometry — `app/lib/constants.ts`

`SKYLINE_REFERENCE_POLYLINE` becomes the Mussel Rock → Arastradero line, simplified to ≤ 250 points (Douglas–Peucker, 15 m tolerance — the script in §3.2 does it; no runtime dependency). Update its doc comment (activity id, date, point count, length). `SEGMENT_CORRIDORS.skyline` gains `profile: () => import("./corridors/skyline-profile.json")` so the heavy data loads only with the route view.

The sanity values in phase-07 §5.1 change; the script prints the new first/last point, point count and length for the tests in §6.

Cut points, as the two nearest stream samples to:
- start: Mussel Rock, `[37.6687, -122.4931]` (the existing "Skyline North" gateway is 700 m further along; keep the gateway as is — it is for ride classification, not for this line);
- end: `(Phillip confirms)` the Arastradero Rd turn.

### 3.2 Corridor profile — `app/lib/corridors/skyline-profile.json`, `scripts/gen-corridor-profile.ts`

```ts
interface CorridorProfile {
  activityId: number;         // provenance
  fetchedAt: string;
  points: number;             // === distance.length === altitude.length === latlng.length
  distance: number[];         // metres from the cut start, strictly increasing
  altitude: number[];         // metres
  latlng: [number, number][]; // 5 decimals
}
```

Script: `node scripts/gen-corridor-profile.ts <activityId> <startLat,startLng> <endLat,endLng>`. Reads `STRAVA_ACCESS_TOKEN` from the environment (Phillip pastes a token from the Strava API settings page or copies one from the local DB; the script never writes anywhere but the JSON). It calls `GET /activities/{id}/streams?keys=distance,altitude,latlng&key_by_type=true` once, cuts at the two nearest samples, re-bases `distance` to 0, downsamples to ≤ 600 points (keep every point where altitude or heading changes by more than a threshold, else every 100 m), writes the JSON and prints the simplified polyline for §3.1. Target size ≤ 40 KB raw, ≤ 10 KB gzipped.

No request-time Strava call, no table: one immutable ride, loaded lazily by the browser.

### 3.3 Projection — `app/lib/segment-corridor.ts`

```ts
/** Nearest point on `line` to `point`: distance to it and how far along the line it is. */
export function projectOntoPolyline(
  point: [number, number],
  line: [number, number][],
  cumulative?: number[],      // optional precomputed metres at each vertex
): { distanceM: number; alongM: number };
```
`distanceToPolylineMeters` becomes a thin wrapper. `segmentDirection(seg, line)` implements C5. A new pure module `app/lib/segment-lanes.ts` holds `placeSegments(segments, profile) → { id, startM, endM, lane }[]` (projection with `profile.distance` as `cumulative`, then C7 packing).

The RPC (`CREATE OR REPLACE` in migration 046) adds `start_latlng` and `end_latlng` to each segment object. Nothing else in the output changes.

### 3.4 Reclassification — migration 046 + `app/server/segments-admin.ts`

```sql
-- 046: start/end latlng in the board JSON + batch corridor update for admin reclassification
CREATE OR REPLACE FUNCTION get_segment_leaderboard(q jsonb) … ;   -- + 'start_latlng', s.start_latlng, 'end_latlng', s.end_latlng
CREATE FUNCTION batch_update_segment_corridors(p_rows jsonb) RETURNS int   -- [{id, corridor, direction}], service role only
```

`reclassifySegmentCorridors = createServerFn({ method: "POST" })` (`assertAdmin()`): pages `segments` 500 at a time (`id, start_latlng, end_latlng`, ordered by id, cursor in the input), runs `classifySegmentCorridor` + `segmentDirection` in the Worker, sends one `batch_update_segment_corridors` per page, and stops after 20 pages or when done. Returns `{ scanned, changed, nextCursor }`; the DevTools "Reclassify segment corridors" button loops until `nextCursor` is null. 2 subrequests per 500 segments, ≤ 42 per call, logged with `logPerf`. Newly corridor segments with `xoms_fetched_at IS NULL` get their `segment_xoms` job from the existing weekly planner (`enqueue_due_segment_xoms`), nothing extra.

## 4. UI

### 4.1 Files

| File | Role |
|---|---|
| `app/components/CorridorTabs.tsx` | Tabs from `SEGMENT_CORRIDORS`; sets `corridor` in the URL; disabled tabs for corridors without a polyline. |
| `app/components/RouteView.tsx` | Lazy (`React.lazy`, like `GrowthChart`): loads Leaflet and the profile JSON; owns the hover/selection state; lays out `RouteMap` over `ElevationProfile`. Props: `segments` (board rows), `selectedId`, `onSelect(id)`. |
| `app/components/RouteMap.tsx` | Leaflet map: route polyline (grey), one polyline per shown segment (C4), hover marker at the hovered profile distance. `fitBounds` once. Dark mode via the existing `.map-tiles--dark`. |
| `app/components/ElevationProfile.tsx` | SVG: area + line, y ticks (ft or m via `useUnit`), x ticks (mi or km), crosshair with distance/elevation label on hover, then the segment lanes under the axis. `preserveAspectRatio="none"` is **not** used; width comes from a `ResizeObserver` so text stays undistorted. |
| `app/lib/segment-lanes.ts` | `placeSegments`, `packLanes` (pure, unit-tested). |
| `app/lib/corridors/skyline-profile.json` | §3.2. |
| `app/styles/segments.css` | `.route-view`, `.route-map`, `.elevation`, `.elevation__lane`, states. |
| `app/routes/segments.tsx` | Renders `<CorridorTabs>` then `<Suspense><RouteView/></Suspense>` above the filters; passes `selectedId` into `SegmentBoard` (new prop: the row to expand + a `rowRef` to scroll to) and `onHover`/`onSelect` back out. |
| `app/components/DevToolsPanel.tsx` | "Reclassify segment corridors" button + result line (Segments section from 07a). |

### 4.2 Interaction

- One state object in the page: `{ hoveredId: number | null, selectedId: number | null }`. Bars, map lines and board rows read it; `SegmentBoard` expands `selectedId` and scrolls it into view (`scrollIntoView({ block: "center" })`) when it changes.
- Hover on the profile shows the crosshair and moves the map marker; hover on a bar also shows a tooltip (name, distance, grade, KOM, SF2G leader + time) using the existing `Tooltip` component.
- Keyboard: bars are `<button>`s (focusable, Enter = select); the map lines are not (the bars already cover every segment).
- Changing filters (terrain/direction/date) changes the shown segments, so the overlay follows the board. `direction: north` draws the same route (the line is one-directional; northbound segments still sit at their along-track position).

### 4.3 Sizes

- Map 320 px; profile 180 px plus 10 px per lane (6 px on mobile); x-axis ticks every 5 mi / 5 km.
- Fixture profile for tests: `app/test/fixtures/corridor-profile.json`, 40 points generated from the reference line with a synthetic altitude — the component tests never read the 600-point production file.

## 5. Tests (write them first)

Unit (`app/lib/__test__/`):
- `segment-corridor.test.ts` — update the reference-line sanity values; `projectOntoPolyline`: a vertex projects to its own cumulative distance; a point off the line gives the perpendicular foot; `alongM` is monotonic for points sampled along the line; direction per C5 for a south, a north and an east-heading pair on the tail.
- `segment-lanes.test.ts` — `packLanes`: no two bars in one lane overlap; a bar starting exactly where another ends shares its lane; deterministic order; `placeSegments` on three fixture segments returns `startM < endM` and the expected lane indices.
- `corridor-profile.test.ts` — the committed JSON: `points` matches array lengths, `distance` strictly increasing from 0, length within 5 % of the simplified polyline's length, first point within 300 m of Mussel Rock, last within 300 m of the confirmed end.

Component (`app/components/__test__/route-view.test.tsx`, happy-dom, Leaflet mocked to a no-op like any existing map test or rendered with `RouteMap` stubbed):
- renders one bar per board segment from `ui-fixtures.json`; hovering a bar calls `onHover(id)`; clicking calls `onSelect(id)`; the selected bar has `aria-pressed`.
- `ElevationProfile` labels: `ft`/`mi` under `mi`, `m`/`km` under `km`.

DB (`app/server/__test__/db/segments-reclassify.test.ts`):
- insert two throwaway segments (one on the new tail near Arastradero, one 2 km off); `reclassifySegmentCorridorsImpl` sets `skyline`/`south` on the first, leaves `NULL` on the second, reports `changed: 1`; the RPC output now carries `start_latlng`; goldens and `EXPECTED.segments` unchanged **unless** the fixture sampling indices moved with the new line — then `pnpm fixtures` regenerates them and the PR says so (one sentence).

E2E (`e2e/pages.spec.ts`):
- `/segments` tiles load (reuse the `/routes` tile test); clicking the first segment bar expands a board row (`View on Strava` becomes visible) and the row is in the viewport.

## 6. Steps, in order

1. Phillip answers the two `(Phillip confirms)` items (end coordinate; which activity). Until then, steps 2–4 can proceed with the current 26.6 km line as the stand-in.
2. Write §5 unit tests; implement `projectOntoPolyline`, C5 direction, `segment-lanes.ts`.
3. `scripts/gen-corridor-profile.ts`; run it; commit the JSON and the new `SKYLINE_REFERENCE_POLYLINE`; fix the sanity tests; `pnpm fixtures && pnpm db:reset`; `pnpm test:db` (note any golden change).
4. Migration 046; `pnpm db:types`; `reclassifySegmentCorridors` + DevTools button; db test.
5. `ElevationProfile`, `RouteMap`, `RouteView`, `CorridorTabs`; page wiring; CSS; component tests.
6. E2E; `pnpm typecheck && pnpm test && pnpm test:db && pnpm e2e`.
7. PR (base: 07b until #28 merges). Description: deploy order (046 after 045), then run "Reclassify segment corridors" once in prod DevTools, and the bundle delta of the lazy chunk (Leaflet is already shipped by `/routes`; the new cost is the profile JSON + ~15 KB of components).

## 7. Done when

- [ ] §5 green; goldens unchanged or explained.
- [ ] `/segments` loads with **one** `get_segment_leaderboard` call (`[perf] fetchSegmentLeaderboard subreq=1`) and no request-time Strava call; the profile JSON is a separate lazy chunk.
- [ ] Every segment on the board has a bar and a map line; hover/click sync works in both directions; the selected row scrolls into view.
- [ ] After the prod reclassification, segments on the Kings Mountain descent and Alpine/Arastradero appear on the board (Phillip checks).
- [ ] Phone width: no horizontal page scroll; map, profile and lanes fit 375 px.

## 8. Risks

- **Overlapping corridors later.** When Bayway/HMBW lines are added, the Woodside → Arastradero tail belongs to more than one corridor; `segments.corridor` is single-valued. Decide then (first match in `SEGMENT_CORRIDORS` order, or a join table). Not needed for Skyline alone.
- **The source ride deviates from the canonical route** (a detour, a stop). Pick a clean ride; the script prints total length and max gap between samples so a bad one is obvious.
- **Tail segments ridden on non-Skyline routes.** Only `route_category = 'skyline'` rides are fetched (D10), so efforts from HMBW riders on Alpine never enter. Fine for v1; note for the Bayway/HMBW phase.
- **Altitude noise.** Strava altitude streams are already smoothed; the downsampling keeps extrema, so the profile matches Strava's own.

## 9. Sub-phase 07d — the rest of the old 07c

DevTools curation (`setSegmentCuration({ id, curated_rank, hidden })`, `assertAdmin()`), profile-page strip (`get_rider_segment_summary(p_user_id)`, opted-in riders only), `CopyLinkButton` on `/segments`, PostHog events `segments_viewed` (with filters) and `segment_board_opt_in`, and — if wanted — real segment polylines from `GET /segments/{id}` stored on `segments.polyline` by `segmentXomsStep`. Tests as listed in the old §8.
