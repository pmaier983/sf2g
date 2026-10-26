/**
 * SegmentQuery — the validated state behind /segments, stored in the URL.
 *
 * Same rules as TableQuery (table-query.ts): every field `.catch()`es to its
 * default so a hand-edited URL never throws, defaults are dropped when
 * serializing, and the date preset is resolved in America/Los_Angeles.
 *
 * `toSegmentSqlParams` maps it onto get_segment_leaderboard(q jsonb)
 * (migration 045).
 */
import { z } from "zod";
import { SEGMENT_MIN_RIDERS, type SegmentCorridor } from "./constants";
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
