/**
 * CumulativeQuery — the validated state behind /segments (phase 09), stored
 * in the URL.
 *
 * Same rules as TableQuery (table-query.ts): every field `.catch()`es to its
 * default so a hand-edited URL never throws, and defaults are dropped when
 * serializing. `toMatrixParams` maps it onto get_segment_matrix(q jsonb)
 * (migration 052); the selection itself is applied in the browser.
 */
import { z } from "zod";
import { SEGMENT_CORRIDORS, type SegmentCorridor } from "./constants";

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
