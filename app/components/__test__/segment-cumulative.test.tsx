/**
 * Phase 09d: the cumulative board, the crown view and the picker, rendered
 * from the fixture matrix (ui-fixtures.json → segmentMatrix).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/render";
import fixtures from "../../test/ui-fixtures.json";
import {
  buildMatrix,
  crown,
  cumulative,
  type SegmentMatrixResponse,
} from "../../lib/segment-cumulative";
import { DEFAULT_CUMULATIVE_QUERY } from "../../lib/segment-query";
import { CumulativeBoard } from "../CumulativeBoard";
import { CumulativeStats } from "../CumulativeStats";
import { SegmentCrownView } from "../SegmentCrownView";
import { SegmentPicker } from "../SegmentPicker";

const raw = (fixtures as unknown as { segmentMatrix: SegmentMatrixResponse })
  .segmentMatrix;
const matrix = buildMatrix(raw);
const ids = matrix.segments.map((s) => s.id);
const result = cumulative(matrix, ids);

describe("CumulativeBoard", () => {
  it("ranks riders with ≥ 80 % of the segments and lists the rest separately", async () => {
    renderWithProviders(<CumulativeBoard matrix={matrix} result={result} />);
    const ranked = await screen.findByRole("table", {
      name: "Cumulative leaderboard",
    });
    const rows = within(ranked).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(result.ranked.length);
    expect(rows[0].textContent).toContain(result.ranked[0].rider.display_name);
    const partial = screen.getByRole("table", {
      name: "Riders missing segments",
    });
    expect(within(partial).getAllByRole("row").slice(1)).toHaveLength(
      result.partial.length,
    );
    expect(screen.getByText(/not ranked/)).toBeTruthy();
  });

  it("a row expands to the rider's splits, filled ones marked missing", async () => {
    renderWithProviders(<CumulativeBoard matrix={matrix} result={result} />);
    const table = await screen.findByRole("table", {
      name: "Cumulative leaderboard",
    });
    const withGap = result.ranked.find((r) => r.done < r.of)!;
    fireEvent.click(
      within(table).getByText(withGap.rider.display_name).closest("tr")!,
    );
    expect(screen.getAllByText("missing").length).toBe(
      withGap.of - withGap.done,
    );
    expect(screen.getAllByRole("link", { name: "View on Strava" }).length).toBe(
      withGap.done,
    );
  });
});

describe("KOM honours", () => {
  // Make the 900001 leader's time the Strava KOM.
  const leader = matrix.bySegment.get(900001)![0];
  const withKom = buildMatrix({
    ...raw,
    segments: raw.segments.map((s) =>
      s.id === 900001 ? { ...s, overall_seconds: leader.seconds } : s,
    ),
  });
  const res = cumulative(withKom, ids);
  const holder = withKom.riderById.get(leader.user_id)!;

  it("the stats banner names the SF2G rider holding a Strava KOM", async () => {
    renderWithProviders(
      <CumulativeStats matrix={withKom} result={res} routeLabel="Skyline" />,
    );
    const banner = await screen.findByRole("note");
    expect(banner.textContent).toContain(holder.display_name);
    expect(banner.textContent).toContain("Skyline Climb A");
  });

  it("the holder's row shows a crown count; the crown view sorts KOMs first", async () => {
    renderWithProviders(<CumulativeBoard matrix={withKom} result={res} />);
    const table = await screen.findByRole("table", {
      name: "Cumulative leaderboard",
    });
    const row = within(table).getByText(holder.display_name).closest("tr")!;
    expect(within(row).getByTitle("Holds 1 Strava KOM")).toBeTruthy();

    const rows = crown(withKom, ids);
    expect(rows[0].rider.user_id).toBe(holder.user_id);
    expect(rows[0].strava_koms).toBe(1);
  });
});

describe("SegmentCrownView", () => {
  it("renders one row per rider with records and points", async () => {
    const rows = crown(matrix, ids);
    renderWithProviders(<SegmentCrownView rows={rows} />);
    const table = await screen.findByRole("table", { name: "Segment crown" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(
      rows.length,
    );
  });
});

describe("SegmentPicker", () => {
  it("presets set the URL state; Remove overlaps appears only with overlap", async () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    renderWithProviders(
      <SegmentPicker
        query={DEFAULT_CUMULATIVE_QUERY}
        onChange={onChange}
        years={[2026, 2025]}
        lengthBounds={[0.3, 6]}
        selected={{ count: 5, distanceM: 9000, climbM: 200 }}
        overlapM={0}
        onRemoveOverlaps={onRemove}
      />,
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Climbs" }));
    expect(onChange).toHaveBeenCalledWith({ set: "climbs", seg: [] });
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "2025" },
    });
    expect(onChange).toHaveBeenCalledWith({ year: 2025 });
    expect(screen.queryByText("Remove overlaps")).toBeNull();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("shows the overlap and calls back to remove it", async () => {
    const onRemove = vi.fn();
    renderWithProviders(
      <SegmentPicker
        query={{ ...DEFAULT_CUMULATIVE_QUERY, overlap: true }}
        onChange={() => {}}
        years={[]}
        lengthBounds={[0.3, 6]}
        selected={{ count: 3, distanceM: 5000, climbM: 100 }}
        overlapM={1200}
        onRemoveOverlaps={onRemove}
      />,
    );
    expect(await screen.findByText(/counted twice/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove overlaps" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("the length slider writes a range into the URL after a pause", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderWithProviders(
      <SegmentPicker
        query={DEFAULT_CUMULATIVE_QUERY}
        onChange={onChange}
        years={[]}
        lengthBounds={[0.3, 6]}
        selected={{ count: 5, distanceM: 9000, climbM: 200 }}
        overlapM={0}
        onRemoveOverlaps={() => {}}
      />,
    );
    await vi.runOnlyPendingTimersAsync();
    fireEvent.change(screen.getByLabelText("Shortest segment (km)"), {
      target: { value: "1.5" },
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenLastCalledWith({ min: 1.5, max: null });
    vi.useRealTimers();
  });
});
