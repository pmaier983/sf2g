import { characterize, freezeFixtureClock } from "../../../test/characterize";
import {
  fetchCommunityBreakdownImpl,
  fetchDailyGrowthDataImpl,
  fetchLeaderboardImpl,
  fetchPprDawnRiderIdsImpl,
  fetchRiderGrowthDataImpl,
  fetchRouteSpeedLeaderboardImpl,
} from "../../leaderboard";

freezeFixtureClock();

// One SQL function (get_leaderboard) answers every filter combination.
// The fetchFilteredLeaderboard (JS path) goldens it replaced were reproduced
// exactly before they were removed — see the phase 03a PR.
characterize("fetchLeaderboard", fetchLeaderboardImpl, {
  "no filters (weekends excluded by default)": {},
  "weekends included": { excludeWeekends: false },
  "sort avg speed asc": { sort: "avg_speed_mps", dir: "asc" },
  "sort median watts desc": { sort: "median_watts", dir: "desc" },
  "sort % distance desc": { sort: "sf2g_dist_pct", dir: "desc" },
  "sort display name asc": { sort: "display_name", dir: "asc" },
  "date range 2025": { dateFrom: "2025-01-01", dateTo: "2025-12-31" },
  "date range 2025, weekends included": {
    dateFrom: "2025-01-01",
    dateTo: "2025-12-31",
    excludeWeekends: false,
  },
  "only dateFrom": { dateFrom: "2026-01-01" },
  "invalid date is ignored": { dateFrom: "not-a-date" },
  "skyline only": { routes: ["skyline"] },
  "bayway + royale": { routes: ["bayway", "royale"] },
  "other only": { routes: ["other"] },
  "include other": { includeOther: true },
  "company google": { company: "google" },
  "reverse commutes": { reverse: true },
  "PPR at dawn": { ppr: true },
  "PPR at dawn, skyline, 2026": {
    ppr: true,
    routes: ["skyline"],
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
  },
  "search 'ada'": { search: "ada" },
  "skyline in 2026, sorted by sf2g_total asc": {
    routes: ["skyline"],
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    sort: "sf2g_total",
    dir: "asc",
  },
  "garbage input falls back to defaults": {
    routes: ["nope"],
    sort: "drop table",
    dir: "sideways",
    company: "acme",
  } as never,
});

characterize("fetchPprDawnRiderIds", fetchPprDawnRiderIdsImpl, {
  "all time": {},
  "2026 only": { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
  "skyline only": { routeCategories: ["skyline"] },
});

characterize("fetchRouteSpeedLeaderboard", fetchRouteSpeedLeaderboardImpl, {
  skyline: { routeCategory: "skyline" },
  bayway: { routeCategory: "bayway" },
  "invalid route": { routeCategory: "nope" as "skyline" },
});

characterize("fetchRiderGrowthData", () => fetchRiderGrowthDataImpl(), {
  default: undefined,
});
characterize("fetchDailyGrowthData", () => fetchDailyGrowthDataImpl(), {
  default: undefined,
});
characterize("fetchCommunityBreakdown", () => fetchCommunityBreakdownImpl(), {
  default: undefined,
});
