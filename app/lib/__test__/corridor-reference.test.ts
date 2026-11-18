import { describe, expect, it } from "vitest";
import { rankTypicalRides } from "../corridor-reference";

type LatLng = [number, number];
/** A line from (37.70, -122.40) south 30 km, with a lateral offset in metres. */
function line(offsetM: number, detour = false): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i <= 60; i++) {
    const lat = 37.7 - i * 0.0045;
    let lng = -122.4 + offsetM / 88_000;
    // A 3 km sideways detour in the middle.
    if (detour && i > 25 && i < 35) lng += 3000 / 88_000;
    pts.push([lat, lng]);
  }
  return pts;
}

describe("rankTypicalRides", () => {
  const rides = [
    { id: "a", line: line(0) },
    { id: "b", line: line(40) },
    { id: "c", line: line(-30) },
    { id: "d", line: line(20) },
    { id: "e", line: line(-10) },
    { id: "detour", line: line(0, true) },
  ];

  it("never picks the detour, and ranks the line closest to everyone first", () => {
    const ranked = rankTypicalRides(rides);
    expect(ranked[ranked.length - 1].id).toBe("detour");
    // The middle of the bundle (offset 0, -10 or 20) wins over the edges.
    expect(["a", "e", "d"]).toContain(ranked[0].id);
    expect(ranked[0].scoreM).toBeLessThan(ranked[ranked.length - 1].scoreM);
  });

  it("is deterministic and scores in metres", () => {
    expect(rankTypicalRides(rides)).toEqual(
      rankTypicalRides([...rides].reverse()),
    );
    expect(rankTypicalRides(rides)[0].scoreM).toBeLessThan(60);
  });

  it("ignores lines too short to be the route", () => {
    const ranked = rankTypicalRides([
      ...rides,
      { id: "stub", line: line(0).slice(0, 3) },
    ]);
    expect(ranked.map((r) => r.id)).not.toContain("stub");
  });
});
