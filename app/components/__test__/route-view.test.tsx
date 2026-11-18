/**
 * /segments route view (phase 07c; picker since 09d): the elevation
 * profile's segment lanes, the route view's wiring (map stubbed — Leaflet
 * needs a real browser), the lanes as the segment picker, and the Segments
 * view following a focus request.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/render";
import fixtures from "../../test/ui-fixtures.json";
import profileJson from "../../test/fixtures/corridor-profile.json";
import type { CorridorProfile } from "../../lib/corridor-profile";
import { placeSegments } from "../../lib/segment-lanes";
import {
  buildMatrix,
  segmentBoard,
  type SegmentMatrixResponse,
} from "../../lib/segment-cumulative";
import type { RouteSegment } from "../../lib/route-segment";
import { ElevationProfile } from "../ElevationProfile";
import { SegmentBoards } from "../SegmentBoards";
import RouteView from "../RouteView";

vi.mock("../RouteMap", () => ({
  RouteMap: () => <div data-testid="route-map" />,
}));
vi.mock("../../lib/corridor-profile", async (orig) => ({
  ...(await orig<typeof import("../../lib/corridor-profile")>()),
  loadCorridorProfile: async () =>
    (await import("../../test/fixtures/corridor-profile.json"))
      .default as CorridorProfile,
}));

const profile = profileJson as CorridorProfile;
const matrix = buildMatrix(
  (fixtures as unknown as { segmentMatrix: SegmentMatrixResponse })
    .segmentMatrix,
);
const segments: RouteSegment[] = matrix.segments.map((s) => {
  const lead = segmentBoard(matrix, s.id)[0];
  return {
    ...s,
    leader: lead
      ? {
          display_name: lead.rider.display_name,
          best_seconds: lead.cell.seconds,
        }
      : null,
  };
});
const byId = new Map(segments.map((s) => [s.id, s]));
const bars = placeSegments(segments, profile);

function renderProfile(
  over: Partial<Parameters<typeof ElevationProfile>[0]> = {},
) {
  const onHover = vi.fn();
  const onSelect = vi.fn();
  renderWithProviders(
    <ElevationProfile
      profile={profile}
      bars={bars}
      segments={byId}
      unit="mi"
      hoveredId={null}
      selectedId={null}
      onHover={onHover}
      onSelect={onSelect}
      {...over}
    />,
  );
  return { onHover, onSelect };
}

describe("ElevationProfile", () => {
  it("draws one bar per board segment, placed along the route", async () => {
    renderProfile();
    const group = await screen.findByRole("group", {
      name: "Segments along the route",
    });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(segments.length);
    expect(buttons.map((b) => Number(b.dataset.segmentId)).sort()).toEqual(
      segments.map((s) => s.id).sort(),
    );
    // The matrix lists segments in route order.
    const lefts = segments.map((s) =>
      parseFloat(
        (group.querySelector(`[data-segment-id="${s.id}"]`) as HTMLElement)
          .style.left,
      ),
    );
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
  });

  it("hover and click report the segment; the selected bar is pressed", async () => {
    const seg = segments[1];
    const { onHover, onSelect } = renderProfile({ selectedId: seg.id });
    const bar = await screen.findByRole("button", {
      name: new RegExp(`^${seg.name},`),
    });
    expect(bar.getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseEnter(bar);
    expect(onHover).toHaveBeenLastCalledWith(seg.id);
    fireEvent.mouseLeave(bar);
    expect(onHover).toHaveBeenLastCalledWith(null);
    fireEvent.click(bar);
    expect(onSelect).toHaveBeenCalledWith(seg.id);
    // The info line describes the selected segment.
    expect(screen.getByText(new RegExp(`^${seg.name} ·`))).toBeTruthy();
  });

  it("labels ft / mi in imperial and m / km in metric", async () => {
    renderProfile({ unit: "mi" });
    expect(await screen.findByText("0 mi")).toBeTruthy();
    expect(screen.getAllByText(/ ft$/).length).toBeGreaterThan(1);
  });

  it("labels m / km in metric", async () => {
    renderProfile({ unit: "km" });
    expect(await screen.findByText("0 km")).toBeTruthy();
    expect(screen.getAllByText(/ m$/).length).toBeGreaterThan(1);
    expect(screen.queryAllByText(/ ft$/)).toHaveLength(0);
  });
});

describe("RouteView", () => {
  it("loads the corridor profile and shows the map and the lanes", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <RouteView
        corridor="skyline"
        segments={segments}
        hoveredId={null}
        selectedId={null}
        onHover={() => {}}
        onSelect={onSelect}
      />,
    );
    expect(await screen.findByTestId("route-map")).toBeTruthy();
    const bar = await screen.findByRole("button", {
      name: new RegExp(`^${segments[0].name},`),
    });
    fireEvent.click(bar);
    expect(onSelect).toHaveBeenCalledWith(segments[0].id);
  });
});

describe("the lanes are the segment picker", () => {
  it("bars outside the selection are outlined and not pressed; a click reports the segment", async () => {
    const included = new Set([segments[0].id, segments[2].id]);
    const { onSelect } = renderProfile({ included });
    const off = await screen.findByRole("button", {
      name: new RegExp(`^${segments[1].name},`),
    });
    const on = screen.getByRole("button", {
      name: new RegExp(`^${segments[0].name},`),
    });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.className).toContain("elevation__bar--off");
    expect(on.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(off);
    expect(onSelect).toHaveBeenCalledWith(segments[1].id);
    expect(screen.getByText(/2 of \d+ segments selected/)).toBeTruthy();
  });
});

describe("SegmentBoards follows the route view", () => {
  const all = new Set(matrix.segments.map((s) => s.id));

  it("a focus request expands that segment's row", async () => {
    const seg = matrix.segments[1];
    const { rerender } = renderBoard(null);
    await screen.findByRole("table", { name: "Segment boards" });
    expect(screen.queryAllByText("View on Strava")).toHaveLength(0);
    rerender({ id: seg.id, n: 1 });
    expect(
      await screen.findAllByRole("link", { name: "View on Strava" }),
    ).toHaveLength(matrix.bySegment.get(seg.id)!.length);
  });

  it("hovering a row reports its segment; the checkbox toggles it", async () => {
    const onHover = vi.fn();
    const onToggle = vi.fn();
    renderWithProviders(
      <SegmentBoards
        matrix={matrix}
        included={all}
        onToggle={onToggle}
        onHover={onHover}
      />,
    );
    const table = await screen.findByRole("table", { name: "Segment boards" });
    const row = within(table).getByText(segments[0].name).closest("tr")!;
    fireEvent.mouseEnter(row);
    expect(onHover).toHaveBeenLastCalledWith(segments[0].id);
    fireEvent.click(
      within(table).getByRole("checkbox", {
        name: `Count ${segments[0].name}`,
      }),
    );
    expect(onToggle).toHaveBeenCalledWith(segments[0].id);
  });

  /** Render the boards with a focus request that can be changed afterwards. */
  function renderBoard(initial: { id: number; n: number } | null) {
    let set: (r: { id: number; n: number } | null) => void = () => {};
    function Harness() {
      const [req, setReq] = useState(initial);
      set = setReq;
      return (
        <SegmentBoards
          matrix={matrix}
          included={all}
          onToggle={() => {}}
          focusRequest={req}
        />
      );
    }
    renderWithProviders(<Harness />);
    return {
      rerender: (r: { id: number; n: number } | null) => act(() => set(r)),
    };
  }
});
