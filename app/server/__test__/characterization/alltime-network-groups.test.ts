import {
  RIDER,
  characterize,
  freezeFixtureClock,
} from "../../../test/characterize";
import { fetchAllTimeLeaderboardImpl } from "../../alltime";
import { fetchRiderNetworkImpl } from "../../network";
import {
  fetchGroupRideDetailImpl,
  fetchGroupRidesImpl,
} from "../../group-rides";

freezeFixtureClock();

characterize("fetchAllTimeLeaderboard", fetchAllTimeLeaderboardImpl, {
  "7-day window": { durationDays: 7 },
  "30-day window, weekends excluded": {
    durationDays: 30,
    excludeWeekends: true,
  },
  "365-day window skyline": { durationDays: 365, routes: ["skyline"] },
  "365-day window incl. other": { durationDays: 365, includeOther: true },
  "30-day window in 2025": {
    durationDays: 30,
    dateFrom: "2025-01-01",
    dateTo: "2025-12-31",
  },
  "invalid duration": { durationDays: -1 },
});

characterize("fetchRiderNetwork", () => fetchRiderNetworkImpl(), {
  default: undefined,
});

characterize("fetchGroupRides", fetchGroupRidesImpl, {
  "default page": {},
  "skyline only": { routeCategories: ["skyline"] },
  "2026 only": { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
  "sort by riders desc": { sortBy: "riders", sortDir: "desc" },
  "weekends included": { weekends: true },
});

characterize(
  "fetchGroupRideDetail",
  async ({ date, route }: { date: string; route: string }) => {
    // Group ride ids are content hashes; look the real one up first.
    const list = await fetchGroupRidesImpl({ dateFrom: date, dateTo: date });
    const group = list.groupRides.find(
      (g) => g.date === date && g.routeCategory === route,
    );
    if (!group) throw new Error(`no ${route} group on ${date}`);
    return fetchGroupRideDetailImpl({
      id: group.id,
      date,
      route: route as "skyline",
      riderIds: group.riders.map((r) => r.userId),
    });
  },
  {
    "2026-10-13 skyline (ada, ben, cam)": {
      date: "2026-10-13",
      route: "skyline",
    },
    "2026-09-29 bayway (ada, dee, fay)": {
      date: "2026-09-29",
      route: "bayway",
    },
  },
);
