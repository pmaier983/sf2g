/**
 * Phase 09f: the profile strip reads the cached matrix and shows the rider's
 * place on each route's Core board; nothing for a rider with no times.
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { createTestQueryClient, renderWithProviders } from "../../test/render";
import fixtures from "../../test/ui-fixtures.json";
import {
  buildMatrix,
  cumulative,
  selectSegments,
  type SegmentMatrixResponse,
} from "../../lib/segment-cumulative";
import { segmentMatrixQueryOptions } from "../../queries/segments";
import { ProfileSegmentStrip } from "../ProfileSegmentStrip";

const raw = (fixtures as unknown as { segmentMatrix: SegmentMatrixResponse })
  .segmentMatrix;
const m = buildMatrix(raw);
const r = cumulative(
  m,
  selectSegments(m.segments, { set: "core", minKm: null, maxKm: null }).map(
    (s) => s.id,
  ),
);

function render(userId: string) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    segmentMatrixQueryOptions({
      corridor: "skyline",
      direction: "south",
      year: null,
    }).queryKey,
    raw,
  );
  return renderWithProviders(<ProfileSegmentStrip userId={userId} />, {
    queryClient,
  });
}

describe("ProfileSegmentStrip", () => {
  it("shows a ranked rider's place and total", async () => {
    const top = r.ranked[0];
    render(top.rider.user_id);
    expect(await screen.findByText(`#1 of ${r.ranked.length}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skyline core" })).toBeTruthy();
  });

  it("shows how many segments a partial rider has", async () => {
    const p = r.partial[0];
    render(p.rider.user_id);
    expect(
      await screen.findByText(
        new RegExp(`${p.done} of ${p.of} segments ridden`),
      ),
    ).toBeTruthy();
  });

  it("renders no line for a rider with no times", async () => {
    render("00000000-0000-4000-8000-0000000000aa");
    expect(screen.queryByRole("link", { name: "Skyline core" })).toBeNull();
  });
});
