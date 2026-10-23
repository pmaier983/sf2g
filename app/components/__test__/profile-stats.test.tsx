/**
 * D5: the profile stats card and the profile header must count SF2G rides
 * the same way — excluding "Other" — like every leaderboard.
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/render";
import fixtures from "../../test/ui-fixtures.json";
import { ProfileRideStats } from "../ProfileRideStats";
import type { ProfileRide } from "../../lib/database.types";

describe("ProfileRideStats", () => {
  it("D5: 'SF2G Rides' excludes Other rides (same as the header)", async () => {
    const rides = fixtures.profileRides as unknown as ProfileRide[];
    const other = rides.filter((r) => r.route_category === "other").length;
    expect(other).toBeGreaterThan(0); // the fixture must exercise the case
    const headerCount = rides.filter(
      (r) => r.route_category !== "other",
    ).length;

    renderWithProviders(<ProfileRideStats rides={rides} />);
    const label = await screen.findByText("SF2G Rides");
    const value = label.parentElement?.querySelector(
      ".profile-stats__card-value",
    );
    expect(value?.textContent).toBe(String(headerCount));
  });
});
