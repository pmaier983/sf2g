/**
 * Smoke tests: every table renders real fixture rows without crashing and
 * shows the riders it was given. Behavioral tests arrive with phase 05's
 * shared <DataTable> shell.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/render";
import fixtures from "../../test/ui-fixtures.json";
import { LeaderboardTable } from "../LeaderboardTable";
import { RidesLeaderboardTable } from "../RidesLeaderboardTable";
import { AllTimeTable } from "../AllTimeTable";
import { GroupRidesTable } from "../GroupRidesTable";
import { RouteSpeedTable, type RouteSpeedEntry } from "../RouteSpeedTable";
import { GroupRideComparisonTable } from "../GroupRideComparisonTable";
import { ProfileRidesTable } from "../ProfileRidesTable";
import type {
  LeaderboardEntry,
  RideLeaderboardEntry,
} from "../../lib/database.types";
import type { AllTimeEntry } from "../../server/alltime";
import type {
  GroupRideDetailRider,
  GroupRideSummary,
} from "../../server/group-rides";

vi.mock("../../server/rides", async (orig) => ({
  ...(await orig<typeof import("../../server/rides")>()),
  fetchUserRides: vi.fn(async () => fixtures.userRides),
}));
vi.mock("../../server/auth", async (orig) => ({
  ...(await orig<typeof import("../../server/auth")>()),
  getCurrentUser: vi.fn(async () => null),
}));

const noop = () => {};
const leaderboard = fixtures.leaderboard as unknown as LeaderboardEntry[];

/** The test DOM has no layout, so virtualized tables may render a window only. */
async function expectSomeRiderVisible(names: string[]) {
  const found = await Promise.all(
    names.map((n) => screen.findAllByText(n, { exact: false }).catch(() => [])),
  );
  expect(found.flat().length).toBeGreaterThan(0);
}

describe("table smoke tests", () => {
  it("LeaderboardTable", async () => {
    renderWithProviders(
      <LeaderboardTable
        data={leaderboard}
        searchFilter=""
        riderColorMap={new Map()}
        onViewRides={noop}
        sortBy="sf2g_total"
        sortDir="desc"
        onSortChange={noop}
        density="expanded"
      />,
    );
    await expectSomeRiderVisible(leaderboard.map((r) => r.display_name ?? ""));
  });

  it("RidesLeaderboardTable", async () => {
    const page = fixtures.ridesLeaderboard as unknown as {
      rides: RideLeaderboardEntry[];
      totalCount: number;
    };
    renderWithProviders(
      <RidesLeaderboardTable
        rides={page.rides}
        isLoading={false}
        sortBy="ride_date"
        sortDir="desc"
        onSortChange={noop}
        hasNextPage={false}
        fetchNextPage={noop}
        isFetchingNextPage={false}
      />,
    );
    await expectSomeRiderVisible(page.rides.map((r) => r.display_name ?? ""));
  });

  it("AllTimeTable", async () => {
    const rows = fixtures.allTime as unknown as AllTimeEntry[];
    renderWithProviders(
      <AllTimeTable
        data={rows}
        isLoading={false}
        sortBy="maxRidesInWindow"
        sortDir="desc"
        onSortChange={noop}
        searchFilter=""
        durationLabel="30 days"
      />,
    );
    await expectSomeRiderVisible(rows.map((r) => r.displayName));
  });

  it("GroupRidesTable", async () => {
    const rows = (
      fixtures.groupRides as unknown as { groupRides: GroupRideSummary[] }
    ).groupRides;
    const { container } = renderWithProviders(
      <GroupRidesTable
        data={rows}
        isLoading={false}
        onGroupRideClick={noop}
        sortBy="date"
        sortDir="desc"
        onSortChange={noop}
      />,
    );
    await screen.findAllByText(/skyline/i);
    expect(container.querySelectorAll("tr").length).toBeGreaterThan(1);
  });

  it("RouteSpeedTable", async () => {
    const rows = fixtures.routeSpeed as unknown as RouteSpeedEntry[];
    renderWithProviders(
      <RouteSpeedTable
        data={rows}
        searchFilter=""
        riderColorMap={new Map()}
        onViewRides={noop}
        onVisibleRidersChange={noop}
      />,
    );
    await expectSomeRiderVisible(rows.map((r) => r.display_name ?? ""));
  });

  it("GroupRideComparisonTable", async () => {
    const riders = (
      fixtures.groupRideDetail as unknown as {
        riders: GroupRideDetailRider[];
      }
    ).riders;
    renderWithProviders(
      <GroupRideComparisonTable
        riders={riders}
        riderColors={riders.map(() => "#f60")}
      />,
    );
    await expectSomeRiderVisible(riders.map((r) => r.displayName));
  });

  it("ProfileRidesTable (server functions mocked)", async () => {
    const rides = fixtures.userRides;
    const { container } = renderWithProviders(
      <ProfileRidesTable profileUserId={rides[0].user_id} />,
    );
    await screen.findAllByText(rides[0].name!);
    expect(container.querySelectorAll("tr").length).toBeGreaterThan(1);
  });
});
