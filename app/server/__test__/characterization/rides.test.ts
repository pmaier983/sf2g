import {
  RIDER,
  characterize,
  freezeFixtureClock,
} from "../../../test/characterize";
import {
  fetchCommunityStartHoursImpl,
  fetchCommunityStreaksImpl,
  fetchRidesLeaderboardImpl,
  fetchUserRidesImpl,
} from "../../rides";
import { fetchUserProfileImpl } from "../../users";

freezeFixtureClock();

characterize("fetchUserRides", fetchUserRidesImpl, {
  "fay (has hidden + overridden rides)": { userId: RIDER.fay },
  "fay including hidden": { userId: RIDER.fay, includeHidden: true },
  "ada all rides incl. non-SF2G": { userId: RIDER.ada, includeAllRides: true },
  "ben skyline only": { userId: RIDER.ben, routeCategory: "skyline" },
  "ben page 2 of 10": { userId: RIDER.ben, limit: 10, offset: 10 },
  "gus (no rides)": { userId: RIDER.gus },
});

characterize("fetchRidesLeaderboard", fetchRidesLeaderboardImpl, {
  "default page": {},
  "page 2": { page: 2 },
  "sort by distance asc": { sortBy: "distance_meters", sortDir: "asc" },
  "skyline only": { routeCategories: ["skyline"] },
  "include other": { includeOther: true },
  "exclude weekends": { excludeWeekends: true },
  "reverse commutes": { reverse: true },
  "company apple": { company: "apple" },
  "single rider": { userId: RIDER.cam },
  "date range 2026": { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
});

characterize("fetchCommunityStartHours", () => fetchCommunityStartHoursImpl(), {
  default: undefined,
});
characterize("fetchCommunityStreaks", () => fetchCommunityStreaksImpl(), {
  default: undefined,
});

characterize("fetchUserProfile", fetchUserProfileImpl, {
  ada: { userId: RIDER.ada },
  "missing user": { userId: "00000000-0000-4000-8000-0000000000ff" },
});
