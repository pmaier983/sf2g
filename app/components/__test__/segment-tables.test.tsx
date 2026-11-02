/**
 * /segments tables rendered from the fixture database's real
 * get_segment_leaderboard output (ui-fixtures.json → segments).
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/render";
import fixtures from "../../test/ui-fixtures.json";
import { SegmentCrownTable } from "../SegmentCrownTable";
import { SegmentBoard } from "../SegmentBoard";
import type { SegmentLeaderboard } from "../../server/segments";

const board = (fixtures as unknown as { segments: SegmentLeaderboard })
  .segments;

function riderNames(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((tr) => within(tr).getByRole("link").textContent ?? "");
}

describe("SegmentCrownTable", () => {
  it("renders the fixture crown in rank order", async () => {
    renderWithProviders(<SegmentCrownTable crown={board.crown} />);
    const table = await screen.findByRole("table", { name: "Skyline crown" });
    expect(riderNames(table)).toEqual(board.crown.map((c) => c.display_name));
    const first = within(table).getAllByRole("row")[1];
    const c = board.crown[0];
    expect(first.textContent).toContain(
      `${c.segments_ridden}/${c.segments_total}`,
    );
  });

  it('clicking "Points" sorts by points, highest first', async () => {
    renderWithProviders(<SegmentCrownTable crown={board.crown} />);
    const table = await screen.findByRole("table", { name: "Skyline crown" });
    fireEvent.click(within(table).getByRole("button", { name: /Points/ }));
    const byPoints = [...board.crown]
      .sort((a, b) => b.points - a.points)
      .map((c) => c.display_name);
    expect(riderNames(table)).toEqual(byPoints);
    // The fixture crown is not already in points order.
    expect(byPoints).not.toEqual(board.crown.map((c) => c.display_name));
    expect(
      table
        .querySelector('th[data-column-id="points"]')!
        .getAttribute("aria-sort"),
    ).toBe("descending");
  });
});

describe("SegmentBoard", () => {
  it("expands a segment into its riders with Strava links", async () => {
    renderWithProviders(<SegmentBoard segments={board.segments} />);
    const table = await screen.findByRole("table", {
      name: "Skyline segment board",
    });
    const seg = board.segments[0];
    expect(within(table).queryAllByText("View on Strava")).toHaveLength(0);
    fireEvent.click(within(table).getByText(seg.name));
    const links = within(table).getAllByRole("link", {
      name: "View on Strava",
    });
    expect(links).toHaveLength(seg.riders.length);
    expect(links[0].getAttribute("href")).toBe(
      `https://www.strava.com/activities/${seg.riders[0].strava_activity_id}`,
    );
    expect(links[0].getAttribute("target")).toBe("_blank");
  });
});
