import { describe, expect, it } from "vitest";
import { decodePolyline } from "../polyline";
import { SKYLINE_REFERENCE_POLYLINE } from "../constants";
import {
  classifySegmentCorridor,
  cumulativeDistances,
  distanceToPolylineMeters,
  projectOntoPolyline,
  parseXomTime,
  segmentDirection,
  segmentTerrain,
  type SegmentGeometry,
} from "../segment-corridor";

const line = decodePolyline(SKYLINE_REFERENCE_POLYLINE);

/** Move a point `meters` due east. */
function east([lat, lng]: [number, number], meters: number): [number, number] {
  return [lat, lng + meters / (111_320 * Math.cos((lat * Math.PI) / 180))];
}

const seg = (
  start: [number, number],
  end: [number, number],
  average_grade = 4,
): SegmentGeometry => ({
  start_latlng: start,
  end_latlng: end,
  average_grade,
});

describe("SKYLINE_REFERENCE_POLYLINE", () => {
  it("decodes to the core Skyline route: Sloat/Skyline → Arastradero Rd", () => {
    expect(line.length).toBeGreaterThan(100);
    expect(line.length).toBeLessThanOrEqual(250);
    // Sloat Blvd → Skyline Blvd turn, 1.8 km before "Mussel Rock Climb"
    expect(line[0]).toEqual([37.73327, -122.49734]);
    // Foothill Expwy / Arastradero Rd
    expect(line[line.length - 1]).toEqual([37.39887, -122.13453]);
    const lats = line.map((p) => p[0]);
    const lngs = line.map((p) => p[1]);
    expect(Math.max(...lats)).toBeCloseTo(37.7333, 3);
    expect(Math.min(...lats)).toBeCloseTo(37.399, 3);
    expect(Math.min(...lngs)).toBeCloseTo(-122.5032, 3); // Lake Merced
    expect(Math.max(...lngs)).toBeCloseTo(-122.1345, 3);
    const total = cumulativeDistances(line).at(-1)!;
    expect(total).toBeGreaterThan(55_000);
    expect(total).toBeLessThan(58_000);
  });
});

describe("distanceToPolylineMeters", () => {
  it("is zero on a vertex and measures to the segment, not the vertex", () => {
    expect(distanceToPolylineMeters(line[10], line)).toBeLessThan(0.5);
    const mid: [number, number] = [
      (line[10][0] + line[11][0]) / 2,
      (line[10][1] + line[11][1]) / 2,
    ];
    expect(distanceToPolylineMeters(mid, line)).toBeLessThan(1);
    const d = distanceToPolylineMeters(east(line[10], 300), line);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThanOrEqual(300.5);
  });
});

describe("projectOntoPolyline", () => {
  const cum = cumulativeDistances(line);

  it("a vertex projects onto itself at its cumulative distance", () => {
    for (const i of [0, 10, 50, line.length - 1]) {
      const p = projectOntoPolyline(line[i], line);
      expect(p.distanceM).toBeLessThan(0.5);
      expect(p.alongM).toBeCloseTo(cum[i], 0);
    }
  });

  it("a point off the line projects to the foot of the perpendicular", () => {
    const p = projectOntoPolyline(east(line[10], 150), line);
    expect(p.distanceM).toBeGreaterThan(20);
    expect(p.distanceM).toBeLessThanOrEqual(150.5);
    expect(Math.abs(p.alongM - cum[10])).toBeLessThan(200);
  });

  it("along-track distance grows for points sampled along the line", () => {
    const along = line.map((pt) => projectOntoPolyline(pt, line).alongM);
    for (let i = 1; i < along.length; i++)
      expect(along[i]).toBeGreaterThanOrEqual(along[i - 1]);
  });

  it("uses the given cumulative distances (e.g. a ride's distance stream)", () => {
    const scaled = cum.map((d) => d * 1.02);
    expect(projectOntoPolyline(line[20], line, scaled).alongM).toBeCloseTo(
      scaled[20],
      0,
    );
  });

  it("matches distanceToPolylineMeters", () => {
    const pt = east(line[40], 250);
    expect(projectOntoPolyline(pt, line).distanceM).toBeCloseTo(
      distanceToPolylineMeters(pt, line),
      6,
    );
  });
});

describe("classifySegmentCorridor / segmentDirection", () => {
  it("a segment from point 10 to point 30 of the line is a southbound Skyline segment", () => {
    const s = seg(line[10], line[30]);
    expect(classifySegmentCorridor(s)).toBe("skyline");
    expect(segmentDirection(s, "skyline")).toBe("south");
  });

  it("the same segment reversed is northbound", () => {
    const s = seg(line[30], line[10]);
    expect(classifySegmentCorridor(s)).toBe("skyline");
    expect(segmentDirection(s, "skyline")).toBe("north");
  });

  it("south means further along the route, even where the route heads north-east", () => {
    // Woodside → Sand Hill: the route climbs in latitude while going forward.
    let pair: [number, number] | null = null;
    for (let i = 0; i < line.length && !pair; i++) {
      for (let j = i + 1; j < Math.min(i + 8, line.length); j++) {
        if (line[i][1] > -122.25 && line[j][0] > line[i][0] + 0.002) {
          pair = [i, j];
          break;
        }
      }
    }
    expect(pair).not.toBeNull();
    const [i, j] = pair!;
    expect(segmentDirection(seg(line[i], line[j]), "skyline")).toBe("south");
    expect(segmentDirection(seg(line[j], line[i]), "skyline")).toBe("north");
    // Without a corridor line, latitude decides (off-corridor segments).
    expect(segmentDirection(seg(line[i], line[j]))).toBe("north");
  });

  it("moving the end 2 km east takes it off the corridor; 300 m east keeps it", () => {
    expect(classifySegmentCorridor(seg(line[10], east(line[30], 2000)))).toBe(
      null,
    );
    expect(classifySegmentCorridor(seg(line[10], east(line[30], 300)))).toBe(
      "skyline",
    );
  });
});

describe("segmentTerrain", () => {
  it("splits climbs, flats and descents at 2 % and -1 %", () => {
    expect(segmentTerrain(2)).toBe("climb");
    expect(segmentTerrain(1.99)).toBe("flat");
    expect(segmentTerrain(-1)).toBe("flat");
    expect(segmentTerrain(-1.01)).toBe("descent");
  });
});

describe("parseXomTime", () => {
  it("parses Strava's m:ss and h:mm:ss strings", () => {
    expect(parseXomTime("4:49")).toBe(289);
    expect(parseXomTime("1:02:11")).toBe(3731);
  });

  it("returns null for anything else", () => {
    expect(parseXomTime("59s")).toBe(null);
    expect(parseXomTime("")).toBe(null);
    expect(parseXomTime(null)).toBe(null);
    expect(parseXomTime(undefined)).toBe(null);
  });
});
