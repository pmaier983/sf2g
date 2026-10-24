/**
 * Leaderboard view tables on the DataTable shell: only sortable columns get
 * a sort button, and every sort key is one the server/URL accepts.
 */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/render";
import fixtures from "../../test/ui-fixtures.json";
import { GroupRidesTable } from "../GroupRidesTable";
import { RidesLeaderboardTable } from "../RidesLeaderboardTable";
import { AllTimeTable } from "../AllTimeTable";
import { SORT_COLUMNS } from "../../lib/table-query";
import type { GroupRideSummary } from "../../server/group-rides";
import type { RideLeaderboardEntry } from "../../lib/database.types";
import type { AllTimeEntry } from "../../server/alltime";

const noop = () => {};

function sortableHeaders(): string[] {
  return screen
    .getAllByRole("columnheader")
    .filter((th) => within(th).queryByRole("button"))
    .map((th) => th.getAttribute("data-column-id") ?? "");
}

describe("view tables sort only by keys the URL accepts", () => {
  it("Groups: Route, Riders and Distance are not sortable (T7)", async () => {
    const rows = (
      fixtures.groupRides as unknown as { groupRides: GroupRideSummary[] }
    ).groupRides;
    renderWithProviders(
      <GroupRidesTable
        data={rows}
        isLoading={false}
        onGroupRideClick={noop}
        sortBy="date"
        sortDir="desc"
        onSortChange={noop}
      />,
    );
    await screen.findAllByRole("columnheader");
    for (const id of ["routeCategory", "riders", "avgDistance"]) {
      const th = document.querySelector(`th[data-column-id="${id}"]`);
      expect(th).not.toBeNull();
      expect(th!.querySelector("button")).toBeNull();
    }
    expect(
      sortableHeaders().every((id) =>
        (SORT_COLUMNS.groups as readonly string[]).includes(id),
      ),
    ).toBe(true);
  });

  it("Rides", async () => {
    const page = fixtures.ridesLeaderboard as unknown as {
      rides: RideLeaderboardEntry[];
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
    await screen.findAllByRole("columnheader");
    const ids = sortableHeaders();
    expect(ids.length).toBeGreaterThan(5);
    expect(
      ids.every((id) => (SORT_COLUMNS.rides as readonly string[]).includes(id)),
    ).toBe(true);
  });

  it("All-time", async () => {
    renderWithProviders(
      <AllTimeTable
        data={fixtures.allTime as unknown as AllTimeEntry[]}
        isLoading={false}
        searchFilter=""
        durationLabel="1 Week"
        sortBy="maxRidesInWindow"
        sortDir="desc"
        onSortChange={noop}
      />,
    );
    await screen.findAllByRole("columnheader");
    expect(
      sortableHeaders().every((id) =>
        (SORT_COLUMNS.alltime as readonly string[]).includes(id),
      ),
    ).toBe(true);
  });
});
