/**
 * Cumulative segment leaderboard maths (phase 09c, plan §5). Pure; runs in
 * the browser on the matrix from get_segment_matrix (migration 052), so
 * changing the selection never needs a request.
 *
 * - presets: Core chain, All climbs, All flats; a length range; custom ids
 * - resolveChain: the most valuable non-overlapping subset of segments
 * - cumulative: every rider's total over the selection. A rider with ≥ 80 %
 *   of the segments is ranked, each missing segment counted as that
 *   segment's slowest ranked time + 10 % (Phillip, 2026-11-18), so skipping a
 *   segment never helps
 * - honours: Strava KOM (current), former Strava KOM, SF2G record
 * - segmentBoard: one segment's full Strava-style board
 */
import { SEGMENT_CUMULATIVE_MIN_SHARE, SEGMENT_FILL_FACTOR } from "./constants";

// ---------------------------------------------------------------------------
// Matrix (the RPC's shape, cells unpacked)
// ---------------------------------------------------------------------------
export interface MatrixSegment {
  id: number;
  name: string;
  distance_meters: number;
  average_grade: number;
  terrain: "climb" | "flat";
  along_start_m: number | null;
  along_end_m: number | null;
  start_latlng: [number, number];
  end_latlng: [number, number];
  kom_seconds: number | null;
  qom_seconds: number | null;
  overall_seconds: number | null;
  xoms_fetched_at: string | null;
  athlete_count: number | null;
  ride_share: number;
  curated_rank: number | null;
}

export interface MatrixRider {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

/** [segIdx, riderIdx, best_seconds, best_date, strava_activity_id, effort_count, first_date, kom_rank] */
export type RawCell = [
  number,
  number,
  number,
  string,
  number,
  number,
  string,
  number | null,
];

export interface SegmentMatrixResponse {
  corridor: string;
  direction: "south" | "north";
  year: number | null;
  years: number[];
  segments: MatrixSegment[];
  riders: MatrixRider[];
  cells: RawCell[];
}

export interface Cell {
  segment_id: number;
  user_id: string;
  seconds: number;
  date: string;
  strava_activity_id: number;
  efforts: number;
  first_date: string;
  kom_rank: number | null;
}

export interface Matrix {
  segments: MatrixSegment[];
  riders: MatrixRider[];
  segmentById: Map<number, MatrixSegment>;
  riderById: Map<string, MatrixRider>;
  /** segment id → its cells, fastest first. */
  bySegment: Map<number, Cell[]>;
  /** user id → segment id → cell. */
  byRider: Map<string, Map<number, Cell>>;
}

export function buildMatrix(res: SegmentMatrixResponse): Matrix {
  const bySegment = new Map<number, Cell[]>();
  const byRider = new Map<string, Map<number, Cell>>();
  for (const s of res.segments) bySegment.set(s.id, []);
  for (const raw of res.cells) {
    const seg = res.segments[raw[0]];
    const rider = res.riders[raw[1]];
    if (!seg || !rider) continue;
    const cell: Cell = {
      segment_id: seg.id,
      user_id: rider.user_id,
      seconds: raw[2],
      date: raw[3],
      strava_activity_id: raw[4],
      efforts: raw[5],
      first_date: raw[6],
      kom_rank: raw[7],
    };
    bySegment.get(seg.id)!.push(cell);
    if (!byRider.has(rider.user_id)) byRider.set(rider.user_id, new Map());
    byRider.get(rider.user_id)!.set(seg.id, cell);
  }
  for (const cells of bySegment.values())
    cells.sort(
      (a, b) =>
        a.seconds - b.seconds ||
        a.date.localeCompare(b.date) ||
        a.user_id.localeCompare(b.user_id),
    );
  return {
    segments: res.segments,
    riders: res.riders,
    segmentById: new Map(res.segments.map((s) => [s.id, s])),
    riderById: new Map(res.riders.map((r) => [r.user_id, r])),
    bySegment,
    byRider,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
export type SegmentSet = "core" | "climbs" | "flats" | "custom";

export interface SelectionInput {
  set: SegmentSet;
  /** Segment length range in km; null = open. */
  minKm: number | null;
  maxKm: number | null;
  /** Explicit ids, only for set = custom. */
  ids?: readonly number[];
  /** Keep overlapping segments in a preset instead of resolving a chain. */
  overlap?: boolean;
}

/** Overlap tolerated between consecutive segments of a chain. */
export const CHAIN_OVERLAP_TOLERANCE_M = 20;

const span = (s: MatrixSegment): [number, number] => {
  const a = s.along_start_m ?? 0;
  const b = s.along_end_m ?? a + s.distance_meters;
  return a <= b ? [a, b] : [b, a];
};

const inRange = (
  s: MatrixSegment,
  minKm: number | null,
  maxKm: number | null,
) =>
  (minKm === null || s.distance_meters >= minKm * 1000) &&
  (maxKm === null || s.distance_meters <= maxKm * 1000);

/** Segments matching the preset's terrain and the length range, before overlap handling. */
export function filterSegments(
  segments: readonly MatrixSegment[],
  sel: Pick<SelectionInput, "set" | "minKm" | "maxKm">,
): MatrixSegment[] {
  return segments.filter(
    (s) =>
      (sel.set !== "climbs" || s.terrain === "climb") &&
      (sel.set !== "flats" || s.terrain === "flat") &&
      inRange(s, sel.minKm, sel.maxKm),
  );
}

/**
 * Largest-value non-overlapping subset (weighted interval scheduling on the
 * along-track spans). Value = length × (0.25 + ride share): long, popular
 * segments win, and coverage counts even when few rides have been fetched.
 * Deterministic: ties go to the lower id.
 */
export function resolveChain(
  segments: readonly MatrixSegment[],
): MatrixSegment[] {
  const items = [...segments]
    .map((s) => {
      const [a, b] = span(s);
      return { s, a, b, v: (b - a) * (0.25 + s.ride_share) };
    })
    .sort((x, y) => x.b - y.b || x.a - y.a || x.s.id - y.s.id);
  const n = items.length;
  // prev[i]: last j < i that ends before items[i] starts (with tolerance).
  const prev = items.map((it, i) => {
    let j = i - 1;
    while (j >= 0 && items[j].b - CHAIN_OVERLAP_TOLERANCE_M > it.a) j--;
    return j;
  });
  const best = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const take = items[i].v + best[prev[i] + 1];
    best[i + 1] = Math.max(best[i], take);
  }
  const chosen: MatrixSegment[] = [];
  for (let i = n - 1; i >= 0; ) {
    const take = items[i].v + best[prev[i] + 1];
    if (take >= best[i] && take === best[i + 1]) {
      chosen.push(items[i].s);
      i = prev[i];
    } else i--;
  }
  return chosen.reverse();
}

/** Metres counted more than once in a selection. */
export function overlapMeters(segments: readonly MatrixSegment[]): number {
  const spans = segments.map(span).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let covered = 0;
  let curA = -Infinity;
  let curB = -Infinity;
  for (const [a, b] of spans) {
    total += b - a;
    if (a > curB) {
      if (curB > curA) covered += curB - curA;
      curA = a;
      curB = b;
    } else curB = Math.max(curB, b);
  }
  if (curB > curA) covered += curB - curA;
  return Math.max(0, Math.round(total - covered));
}

/** The segments a selection resolves to, in route order. */
export function selectSegments(
  segments: readonly MatrixSegment[],
  sel: SelectionInput,
): MatrixSegment[] {
  let out: MatrixSegment[];
  if (sel.set === "custom") {
    const ids = new Set(sel.ids ?? []);
    out = segments.filter((s) => ids.has(s.id));
  } else {
    const pool = filterSegments(segments, sel);
    out = sel.overlap ? pool : resolveChain(pool);
  }
  return [...out].sort((x, y) => span(x)[0] - span(y)[0] || x.id - y.id);
}

// ---------------------------------------------------------------------------
// Honours (Phillip, 2026-11-18: a KOM is its own recognition)
// ---------------------------------------------------------------------------
export interface Honours {
  /** Best time equals or beats the segment's current Strava KOM. */
  stravaKom: boolean;
  /** Strava ranked an effort #1, but it is no longer the KOM time. */
  formerKom: boolean;
  /** Fastest SF2G rider on the segment (within the period shown). */
  sf2gRecord: boolean;
}

export function stravaKomSeconds(s: MatrixSegment): number | null {
  return s.overall_seconds ?? s.kom_seconds;
}

export function honours(
  cell: Pick<Cell, "seconds" | "kom_rank">,
  segment: MatrixSegment,
  leaderSeconds: number | null,
): Honours {
  const kom = stravaKomSeconds(segment);
  const stravaKom = kom !== null && cell.seconds <= kom;
  return {
    stravaKom,
    formerKom: !stravaKom && cell.kom_rank === 1,
    sf2gRecord: leaderSeconds !== null && cell.seconds === leaderSeconds,
  };
}

// ---------------------------------------------------------------------------
// One segment's board
// ---------------------------------------------------------------------------
export interface BoardRow {
  rider: MatrixRider;
  cell: Cell;
  /** Competition rank: ties share a rank. */
  rank: number;
  gap_seconds: number;
  /** Strava KOM / best time; null when the KOM is unknown. */
  pct_of_kom: number | null;
  honours: Honours;
}

export function segmentBoard(matrix: Matrix, segmentId: number): BoardRow[] {
  const seg = matrix.segmentById.get(segmentId);
  const cells = matrix.bySegment.get(segmentId) ?? [];
  if (!seg || cells.length === 0) return [];
  const leader = cells[0].seconds;
  const kom = stravaKomSeconds(seg);
  let rank = 0;
  return cells.map((cell, i) => {
    if (i === 0 || cell.seconds !== cells[i - 1].seconds) rank = i + 1;
    return {
      rider: matrix.riderById.get(cell.user_id)!,
      cell,
      rank,
      gap_seconds: cell.seconds - leader,
      pct_of_kom:
        kom === null ? null : Math.round((kom / cell.seconds) * 1000) / 1000,
      honours: honours(cell, seg, leader),
    };
  });
}

// ---------------------------------------------------------------------------
// Cumulative
// ---------------------------------------------------------------------------
export interface Split {
  segment_id: number;
  seconds: number;
  /** No time on this segment: the fill time is used. */
  filled: boolean;
  /** Rank on this segment (null when filled). */
  rank: number | null;
  behind_leader_seconds: number;
  date: string | null;
  strava_activity_id: number | null;
  honours: Honours | null;
}

export interface CumulativeRow {
  rider: MatrixRider;
  total_seconds: number;
  /** Segments with a real time. */
  done: number;
  of: number;
  splits: Split[];
  strava_koms: number;
  sf2g_records: number;
}

export interface RankedRow extends CumulativeRow {
  rank: number;
  gap_seconds: number;
}

export interface CumulativeResult {
  /** Segments counted (selected segments that have at least one time). */
  segments: MatrixSegment[];
  ranked: RankedRow[];
  /** Under the 80 % threshold, unranked: most segments first, then time. */
  partial: CumulativeRow[];
  /** Riders needed per segment to be ranked. */
  required: number;
  /** Fastest SF2G time on each segment, summed, and who holds the pieces. */
  dream: {
    total_seconds: number;
    holders: { rider: MatrixRider; segments: number }[];
  };
  /** Sum of Strava KOM times; null if any is unknown. */
  kom_total_seconds: number | null;
  distance_m: number;
  climb_m: number;
}

/** Riders with a time on at least this many of `n` segments are ranked. */
export function requiredSegments(n: number): number {
  return Math.ceil(n * SEGMENT_CUMULATIVE_MIN_SHARE - 1e-9);
}

export function cumulative(
  matrix: Matrix,
  selectedIds: readonly number[],
): CumulativeResult {
  const segments = selectedIds
    .map((id) => matrix.segmentById.get(id))
    .filter(
      (s): s is MatrixSegment =>
        !!s && (matrix.bySegment.get(s.id)?.length ?? 0) > 0,
    );
  const n = segments.length;
  const required = requiredSegments(n);

  const boards = new Map(
    segments.map((s) => [s.id, segmentBoard(matrix, s.id)]),
  );
  const leader = new Map(
    segments.map((s) => [s.id, boards.get(s.id)![0].cell.seconds]),
  );
  const fill = new Map(
    segments.map((s) => {
      const b = boards.get(s.id)!;
      return [
        s.id,
        Math.round(b[b.length - 1].cell.seconds * SEGMENT_FILL_FACTOR),
      ];
    }),
  );
  const rankOf = new Map<string, number>();
  for (const s of segments)
    for (const row of boards.get(s.id)!)
      rankOf.set(`${s.id}|${row.rider.user_id}`, row.rank);

  const rows: CumulativeRow[] = [];
  for (const rider of matrix.riders) {
    const mine = matrix.byRider.get(rider.user_id);
    if (!mine) continue;
    let done = 0;
    let total = 0;
    let komCount = 0;
    let recordCount = 0;
    const splits: Split[] = segments.map((s) => {
      const cell = mine.get(s.id);
      if (!cell) {
        const seconds = fill.get(s.id)!;
        total += seconds;
        return {
          segment_id: s.id,
          seconds,
          filled: true,
          rank: null,
          behind_leader_seconds: seconds - leader.get(s.id)!,
          date: null,
          strava_activity_id: null,
          honours: null,
        };
      }
      done++;
      total += cell.seconds;
      const h = honours(cell, s, leader.get(s.id)!);
      if (h.stravaKom) komCount++;
      if (h.sf2gRecord) recordCount++;
      return {
        segment_id: s.id,
        seconds: cell.seconds,
        filled: false,
        rank: rankOf.get(`${s.id}|${rider.user_id}`) ?? null,
        behind_leader_seconds: cell.seconds - leader.get(s.id)!,
        date: cell.date,
        strava_activity_id: cell.strava_activity_id,
        honours: h,
      };
    });
    if (done === 0) continue;
    rows.push({
      rider,
      total_seconds: total,
      done,
      of: n,
      splits,
      strava_koms: komCount,
      sf2g_records: recordCount,
    });
  }

  const byName = (a: CumulativeRow, b: CumulativeRow) =>
    a.rider.display_name.localeCompare(b.rider.display_name) ||
    a.rider.user_id.localeCompare(b.rider.user_id);
  const eligible = rows
    .filter((r) => n > 0 && r.done >= required)
    .sort(
      (a, b) =>
        a.total_seconds - b.total_seconds || b.done - a.done || byName(a, b),
    );
  const ranked: RankedRow[] = [];
  eligible.forEach((r, i) => {
    const prev = ranked[i - 1];
    ranked.push({
      ...r,
      rank: prev && prev.total_seconds === r.total_seconds ? prev.rank : i + 1,
      gap_seconds: r.total_seconds - eligible[0].total_seconds,
    });
  });
  const partial = rows
    .filter((r) => !(n > 0 && r.done >= required))
    .sort(
      (a, b) =>
        b.done - a.done || a.total_seconds - b.total_seconds || byName(a, b),
    );

  const holdersCount = new Map<string, number>();
  for (const s of segments)
    for (const row of boards.get(s.id)!)
      if (row.honours.sf2gRecord)
        holdersCount.set(
          row.rider.user_id,
          (holdersCount.get(row.rider.user_id) ?? 0) + 1,
        );
  const koms = segments.map(stravaKomSeconds);

  return {
    segments,
    ranked,
    partial,
    required,
    dream: {
      total_seconds: segments.reduce((t, s) => t + leader.get(s.id)!, 0),
      holders: [...holdersCount.entries()]
        .map(([id, count]) => ({
          rider: matrix.riderById.get(id)!,
          segments: count,
        }))
        .sort(
          (a, b) =>
            b.segments - a.segments ||
            a.rider.display_name.localeCompare(b.rider.display_name),
        ),
    },
    kom_total_seconds: koms.every((k) => k !== null)
      ? koms.reduce((t, k) => t! + k!, 0)
      : null,
    distance_m: Math.round(segments.reduce((t, s) => t + s.distance_meters, 0)),
    climb_m: Math.round(
      segments.reduce(
        (t, s) => t + Math.max(0, (s.distance_meters * s.average_grade) / 100),
        0,
      ),
    ),
  };
}

/** Where a rider loses and gains the most against the rider ranked just above. */
export function versusAbove(
  result: CumulativeResult,
  userId: string,
): {
  lose: { segment_id: number; seconds: number } | null;
  gain: { segment_id: number; seconds: number } | null;
} {
  const i = result.ranked.findIndex((r) => r.rider.user_id === userId);
  if (i <= 0) return { lose: null, gain: null };
  const me = result.ranked[i];
  const above = result.ranked[i - 1];
  let lose: { segment_id: number; seconds: number } | null = null;
  let gain: { segment_id: number; seconds: number } | null = null;
  me.splits.forEach((sp, k) => {
    const d = sp.seconds - above.splits[k].seconds;
    if (d > 0 && (!lose || d > lose.seconds))
      lose = { segment_id: sp.segment_id, seconds: d };
    if (d < 0 && (!gain || -d > gain.seconds))
      gain = { segment_id: sp.segment_id, seconds: -d };
  });
  return { lose, gain };
}

// ---------------------------------------------------------------------------
// Crown: honours and podiums over the selection (the old "Skyline crown")
// ---------------------------------------------------------------------------
export interface CrownRow {
  rider: MatrixRider;
  rank: number;
  strava_koms: number;
  sf2g_records: number;
  podiums: number;
  /** Σ max(0, 11 − rank) over the selection (phase 07, D9). */
  points: number;
  segments_ridden: number;
  of: number;
}

/** Sorted by Strava KOMs, then SF2G records, then points, then name. */
export function crown(
  matrix: Matrix,
  selectedIds: readonly number[],
): CrownRow[] {
  const ids = selectedIds.filter(
    (id) => (matrix.bySegment.get(id)?.length ?? 0) > 0,
  );
  const acc = new Map<string, Omit<CrownRow, "rank">>();
  for (const id of ids)
    for (const row of segmentBoard(matrix, id)) {
      const a = acc.get(row.rider.user_id) ?? {
        rider: row.rider,
        strava_koms: 0,
        sf2g_records: 0,
        podiums: 0,
        points: 0,
        segments_ridden: 0,
        of: ids.length,
      };
      a.segments_ridden++;
      if (row.honours.stravaKom) a.strava_koms++;
      if (row.rank === 1) a.sf2g_records++;
      if (row.rank <= 3) a.podiums++;
      a.points += Math.max(0, 11 - row.rank);
      acc.set(row.rider.user_id, a);
    }
  return [...acc.values()]
    .sort(
      (a, b) =>
        b.strava_koms - a.strava_koms ||
        b.sf2g_records - a.sf2g_records ||
        b.points - a.points ||
        a.rider.display_name.localeCompare(b.rider.display_name) ||
        a.rider.user_id.localeCompare(b.rider.user_id),
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Per-segment stats for the Segments view. */
export interface SegmentStats {
  riders: number;
  attempts: number;
  median_seconds: number | null;
  /** Rider with the most efforts (Strava's "local legend", SF2G only). */
  most_efforts: { rider: MatrixRider; efforts: number } | null;
  newest_pr: { rider: MatrixRider; date: string } | null;
  /** Leader's margin over second place. */
  first_gap_seconds: number | null;
  kom_holder: MatrixRider | null;
}

export function segmentStats(matrix: Matrix, segmentId: number): SegmentStats {
  const board = segmentBoard(matrix, segmentId);
  if (board.length === 0)
    return {
      riders: 0,
      attempts: 0,
      median_seconds: null,
      most_efforts: null,
      newest_pr: null,
      first_gap_seconds: null,
      kom_holder: null,
    };
  const times = board.map((r) => r.cell.seconds);
  const mid = Math.floor(times.length / 2);
  const median =
    times.length % 2
      ? times[mid]
      : Math.round((times[mid - 1] + times[mid]) / 2);
  const most = [...board].sort(
    (a, b) => b.cell.efforts - a.cell.efforts || a.rank - b.rank,
  )[0];
  const newest = [...board].sort(
    (a, b) => b.cell.date.localeCompare(a.cell.date) || a.rank - b.rank,
  )[0];
  return {
    riders: board.length,
    attempts: board.reduce((t, r) => t + r.cell.efforts, 0),
    median_seconds: median,
    most_efforts: { rider: most.rider, efforts: most.cell.efforts },
    newest_pr: { rider: newest.rider, date: newest.cell.date },
    first_gap_seconds:
      board.length > 1 ? board[1].cell.seconds - board[0].cell.seconds : null,
    kom_holder: board.find((r) => r.honours.stravaKom)?.rider ?? null,
  };
}
