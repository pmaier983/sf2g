import { characterize, freezeFixtureClock } from "../../../test/characterize";
import {
  fetchCommunityBreakdownImpl,
  fetchCompanyRiderIdsImpl,
  fetchDailyGrowthDataImpl,
  fetchFilteredLeaderboardImpl,
  fetchLeaderboardImpl,
  fetchPprDawnRiderIdsImpl,
  fetchRiderGrowthDataImpl,
  fetchRouteSpeedLeaderboardImpl,
} from "../../leaderboard";

freezeFixtureClock();

characterize("fetchLeaderboard", fetchLeaderboardImpl, {
  "no filters": {},
  "sort avg speed asc": { sortBy: "avg_speed_mps", sortDir: "asc" },
  "sort median watts desc": { sortBy: "median_watts", sortDir: "desc" },
  "date range 2025, weekends excluded (default)": {
    dateFrom: "2025-01-01",
    dateTo: "2025-12-31",
  },
  "date range 2025, weekends included": {
    dateFrom: "2025-01-01",
    dateTo: "2025-12-31",
    excludeWeekends: false,
  },
  "only dateFrom": { dateFrom: "2026-01-01" },
  "invalid date is ignored": { dateFrom: "not-a-date" },
});

characterize("fetchFilteredLeaderboard", fetchFilteredLeaderboardImpl, {
  "skyline only": { routeCategories: ["skyline"] },
  "bayway + royale": { routeCategories: ["bayway", "royale"] },
  "company google": { company: "google" },
  "reverse commutes": { reverse: true },
  "weekends excluded": { excludeWeekends: true },
  "weekends included": { excludeWeekends: false },
  "skyline in 2026, sorted by sf2g_total asc": {
    routeCategories: ["skyline"],
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    sortBy: "sf2g_total",
    sortDir: "asc",
  },
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

characterize("fetchCompanyRiderIds", fetchCompanyRiderIdsImpl, {
  google: { company: "google" },
  apple: { company: "apple" },
  "unknown company": { company: "nope" },
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
