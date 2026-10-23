/**
 * Validated input for the Riders leaderboard, shared by the client (query
 * options), the server function, and tests. Every field is optional and
 * falls back to a default instead of throwing, so a malformed URL can never
 * break the page.
 *
 * `toLeaderboardSqlParams` maps it onto get_leaderboard(q jsonb) (migration 037).
 */
import { z } from "zod";

export const ROUTE_CATEGORY_VALUES = [
  "bayway",
  "skyline",
  "hmbw",
  "royale",
  "fleaway",
  "mebw",
  "febw",
  "other",
] as const;

export const DESTINATION_COMPANY_VALUES = [
  "netflix",
  "google",
  "apple",
  "meta",
  "nvidia",
  "stanford",
  "tesla",
] as const;

/** Columns the Riders table can sort by (must match get_leaderboard). */
export const LEADERBOARD_SORT_COLUMNS = [
  "sf2g_total",
  "total_rides",
  "avg_speed_mps",
  "median_speed_mps",
  "sf2g_distance_meters",
  "sf2g_elevation_meters",
  "total_distance_meters",
  "total_elevation_meters",
  "active_years",
  "last_ride_date",
  "first_ride_date",
  "avg_watts",
  "median_watts",
  "avg_heartrate",
  "avg_kilojoules",
  "bayway_count",
  "skyline_count",
  "hmbw_count",
  "royale_count",
  "fleaway_count",
  "mebw_count",
  "febw_count",
  "other_count",
  "display_name",
  "sf2g_dist_pct",
  "sf2g_elev_pct",
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const LeaderboardQuerySchema = z.object({
  // Unknown route names are dropped (never coerced to another route).
  routes: z
    .array(z.string())
    .catch([])
    .default([])
    .transform((rs) => [
      ...new Set(
        rs.filter((r): r is (typeof ROUTE_CATEGORY_VALUES)[number] =>
          (ROUTE_CATEGORY_VALUES as readonly string[]).includes(r),
        ),
      ),
    ]),
  includeOther: z.boolean().catch(false).default(false),
  dateFrom: isoDate,
  dateTo: isoDate,
  excludeWeekends: z.boolean().catch(true).default(true),
  ppr: z.boolean().catch(false).default(false),
  reverse: z.boolean().catch(false).default(false),
  company: z.enum(DESTINATION_COMPANY_VALUES).optional().catch(undefined),
  search: z.string().max(100).optional().catch(undefined),
  sort: z
    .enum(LEADERBOARD_SORT_COLUMNS)
    .catch("sf2g_total")
    .default("sf2g_total"),
  dir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
});

export type LeaderboardQuery = z.output<typeof LeaderboardQuerySchema>;
export type LeaderboardQueryInput = z.input<typeof LeaderboardQuerySchema>;

export function parseLeaderboardQuery(input: unknown): LeaderboardQuery {
  return LeaderboardQuerySchema.parse(input ?? {});
}

/** Parameters for get_leaderboard(q jsonb). */
export function toLeaderboardSqlParams(
  q: LeaderboardQuery,
): Record<string, unknown> {
  return {
    routes: q.routes,
    include_other: q.includeOther,
    date_from: q.dateFrom ?? null,
    date_to: q.dateTo ?? null,
    exclude_weekends: q.excludeWeekends,
    ppr: q.ppr,
    reverse: q.reverse,
    company: q.company ?? null,
    search: q.search?.trim() || null,
    sort: q.sort,
    dir: q.dir,
  };
}
