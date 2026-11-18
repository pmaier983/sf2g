/**
 * SegmentQuery — the validated state behind /segments, stored in the URL.
 *
 * Same rules as TableQuery (table-query.ts): every field `.catch()`es to its
 * default so a hand-edited URL never throws, defaults are dropped when
 * serializing, and the date preset is resolved in America/Los_Angeles.
 *
 * `toSegmentSqlParams` maps it onto get_segment_leaderboard(q jsonb)
 * (migration 049).
 */
import { z } from "zod";
import {
  SEGMENT_CORRIDORS,
  SEGMENT_MIN_RIDERS,
  type SegmentCorridor,
} from "./constants";
import { DATE_PRESETS, resolveDateRange, type DatePreset } from "./table-query";

export const SEGMENT_TERRAINS = ["all", "climb", "flat"] as const;
export const SEGMENT_DIRECTIONS = ["south", "north", "both"] as const;
export type SegmentTerrainFilter = (typeof SEGMENT_TERRAINS)[number];
export type SegmentDirectionFilter = (typeof SEGMENT_DIRECTIONS)[number];
export type SegmentRange = DatePreset | "all";

export interface SegmentQuery {
  corridor: SegmentCorridor;
  terrain: SegmentTerrainFilter;
  direction: SegmentDirectionFilter;
  range: SegmentRange;
  /** Riders listed per segment (1–50). */
  top: number;
}

export const DEFAULT_SEGMENT_QUERY: SegmentQuery = {
  corridor: "skyline",
  terrain: "all",
  direction: "south",
  range: "all",
  top: 10,
};

const SegmentQuerySchema = z.object({
  corridor: z.enum(["skyline"]).catch(DEFAULT_SEGMENT_QUERY.corridor),
  terrain: z.enum(SEGMENT_TERRAINS).catch(DEFAULT_SEGMENT_QUERY.terrain),
  direction: z.enum(SEGMENT_DIRECTIONS).catch(DEFAULT_SEGMENT_QUERY.direction),
  range: z.enum([...DATE_PRESETS, "all"]).catch(DEFAULT_SEGMENT_QUERY.range),
  top: z.coerce.number().int().min(1).max(50).catch(DEFAULT_SEGMENT_QUERY.top),
});

/** Parse URL search params (or a server-fn input) into a full SegmentQuery. */
export function parseSegmentSearch(raw?: unknown): SegmentQuery {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return SegmentQuerySchema.parse({
    ...DEFAULT_SEGMENT_QUERY,
    ...Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ),
  });
}

/** The URL form: defaults omitted. */
export function serializeSegmentSearch(
  q: SegmentQuery,
): Partial<Record<keyof SegmentQuery, string | number>> {
  const out: Partial<Record<keyof SegmentQuery, string | number>> = {};
  for (const key of Object.keys(
    DEFAULT_SEGMENT_QUERY,
  ) as (keyof SegmentQuery)[]) {
    if (q[key] !== DEFAULT_SEGMENT_QUERY[key]) out[key] = q[key];
  }
  return out;
}

export interface SegmentSqlParams {
  corridor: SegmentCorridor;
  terrain: SegmentTerrainFilter;
  direction: SegmentDirectionFilter;
  date_from: string | null;
  date_to: string | null;
  top: number;
  min_riders: number;
}

/** get_segment_leaderboard's `q`, with the date preset resolved in LA time. */
export function toSegmentSqlParams(
  q: SegmentQuery,
  now: Date = new Date(),
): SegmentSqlParams {
  const dates = q.range === "all" ? null : resolveDateRange(q.range, now);
  return {
    corridor: q.corridor,
    terrain: q.terrain,
    direction: q.direction,
    date_from: dates?.from ?? null,
    date_to: dates?.to ?? null,
    top: q.top,
    min_riders: SEGMENT_MIN_RIDERS,
  };
}

// ---------------------------------------------------------------------------
// Phase 09: the cumulative leaderboard's URL state (plan §5.1)
// ---------------------------------------------------------------------------
export const SEGMENT_SETS = ["core", "climbs", "flats", "custom"] as const;
export const SEGMENT_VIEWS = ["cumulative", "segments", "crown"] as const;
export type SegmentView = (typeof SEGMENT_VIEWS)[number];

export interface CumulativeQuery {
  corridor: SegmentCorridor;
  direction: "south" | "north";
  /** A calendar year, or null for all time. */
  year: number | null;
  set: (typeof SEGMENT_SETS)[number];
  /** Segment length range in km; null = open. */
  min: number | null;
  max: number | null;
  /** Explicit segment ids, only used with set = custom. */
  seg: number[];
  /** Keep overlapping segments in a preset. */
  overlap: boolean;
  view: SegmentView;
}

export const DEFAULT_CUMULATIVE_QUERY: CumulativeQuery = {
  corridor: "skyline",
  direction: "south",
  year: null,
  set: "core",
  min: null,
  max: null,
  seg: [],
  overlap: false,
  view: "cumulative",
};

const km = z.coerce
  .number()
  .min(0)
  .max(100)
  .transform((v) => Math.round(v * 10) / 10);
const CumulativeQuerySchema = z.object({
  corridor: z
    .enum(
      Object.keys(SEGMENT_CORRIDORS) as [SegmentCorridor, ...SegmentCorridor[]],
    )
    .catch(DEFAULT_CUMULATIVE_QUERY.corridor),
  direction: z.enum(["south", "north"]).catch("south"),
  year: z.coerce.number().int().min(2000).max(2100).nullable().catch(null),
  set: z.enum(SEGMENT_SETS).catch("core"),
  min: km.nullable().catch(null),
  max: km.nullable().catch(null),
  seg: z
    .preprocess(
      (v) =>
        (Array.isArray(v)
          ? v.map(String)
          : (typeof v === "number"
              ? String(v)
              : typeof v === "string"
                ? v
                : ""
            ).split(",")
        )
          .map((x) => Number(String(x).trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      z.array(z.number()).max(100),
    )
    .catch([]),
  overlap: z
    .preprocess(
      (v) => v === true || v === 1 || v === "1" || v === "true",
      z.boolean(),
    )
    .catch(false),
  view: z.enum(SEGMENT_VIEWS).catch("cumulative"),
});

/** Parse URL search params into a full CumulativeQuery; never throws. */
export function parseCumulativeSearch(raw?: unknown): CumulativeQuery {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const clean = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ""),
  );
  const q = CumulativeQuerySchema.parse({
    ...DEFAULT_CUMULATIVE_QUERY,
    ...clean,
    seg: clean.seg ?? "",
  });
  if (q.min !== null && q.max !== null && q.min > q.max)
    [q.min, q.max] = [q.max, q.min];
  if (q.set !== "custom") q.seg = [];
  return q;
}

/** The URL form: defaults omitted, ids comma-joined. */
export function serializeCumulativeSearch(
  q: CumulativeQuery,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (q.corridor !== "skyline") out.corridor = q.corridor;
  if (q.direction !== "south") out.direction = q.direction;
  if (q.year !== null) out.year = q.year;
  if (q.set !== "core") out.set = q.set;
  if (q.min !== null) out.min = q.min;
  if (q.max !== null) out.max = q.max;
  if (q.set === "custom" && q.seg.length > 0) out.seg = q.seg.join(",");
  if (q.overlap) out.overlap = 1;
  if (q.view !== "cumulative") out.view = q.view;
  return out;
}

/** get_segment_matrix's `q`: the selection itself is applied in the browser. */
export function toMatrixParams(
  q: Pick<CumulativeQuery, "corridor" | "direction" | "year">,
) {
  return { corridor: q.corridor, direction: q.direction, year: q.year };
}
