/**
 * Component-test fixtures, produced by the real server functions from the
 * fixture database so component tests render real shapes.
 *
 *   SF2G_WRITE_UI_FIXTURES=1 pnpm test:db -- ui-fixtures   # regenerate
 *   pnpm test:db                                            # verify up to date
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { fetchLeaderboardImpl } from "../../leaderboard";
import {
  fetchProfileRidesImpl,
  fetchRidesLeaderboardImpl,
  fetchUserRidesImpl,
} from "../../rides";
import { fetchAllTimeLeaderboardImpl } from "../../alltime";
import {
  fetchGroupRidesImpl,
  fetchGroupRideDetailImpl,
} from "../../group-rides";
import { freezeFixtureClock, RIDER } from "../../../test/characterize";
import { alignNumbers } from "../../../test/golden";

freezeFixtureClock();

const OUT = resolve(__dirname, "../../../test/ui-fixtures.json");

it("ui-fixtures.json matches the fixture database", async () => {
  const groups = await fetchGroupRidesImpl({});
  const g = groups.groupRides.find((x) => x.date === "2026-10-13")!;
  const detail = await fetchGroupRideDetailImpl({
    id: g.id,
    date: g.date,
    route: g.routeCategory,
    riderIds: g.riders.map((r) => r.userId),
  });

  const fixtures = {
    leaderboard: await fetchLeaderboardImpl({}),
    ridesLeaderboard: await fetchRidesLeaderboardImpl({ pageSize: 15 }),
    allTime: await fetchAllTimeLeaderboardImpl({ durationDays: 30 }),
    groupRides: groups,
    groupRideDetail: detail,
    userRides: await fetchUserRidesImpl({ userId: RIDER.ada, limit: 15 }),
    profileRides: await fetchProfileRidesImpl({ userId: RIDER.cam }),
  };
  const json = JSON.stringify(fixtures, null, 2) + "\n";

  if (process.env.SF2G_WRITE_UI_FIXTURES === "1" || !existsSync(OUT)) {
    writeFileSync(OUT, json);
  }
  // Float aggregates wobble in the last bits; compare with tolerance.
  const stored = JSON.parse(readFileSync(OUT, "utf8"));
  const fresh = JSON.parse(json);
  expect(alignNumbers(fresh, stored)).toEqual(stored);
});
