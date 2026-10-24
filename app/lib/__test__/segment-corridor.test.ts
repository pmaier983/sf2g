import { describe, expect, it } from "vitest";
import { decodePolyline } from "../polyline";
import { SKYLINE_REFERENCE_POLYLINE } from "../constants";
import {
  classifySegmentCorridor,
  distanceToPolylineMeters,
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
  it("decodes to the Daly City → Kings Mountain reference ride", () => {
    expect(line).toHaveLength(128);
    expect(line[0]).toEqual([37.67, -122.48692]);
    expect(line[line.length - 1]).toEqual([37.48889, -122.32009]);
    const lats = line.map((p) => p[0]);
    const lngs = line.map((p) => p[1]);
    expect(Math.min(...lats)).toBeCloseTo(37.489, 3);
    expect(Math.max(...lats)).toBeCloseTo(37.67, 3);
    expect(Math.min(...lngs)).toBeCloseTo(-122.487, 3);
    expect(Math.max(...lngs)).toBeCloseTo(-122.32, 3);
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

describe("classifySegmentCorridor / segmentDirection", () => {
  it("a segment from point 10 to point 30 of the line is a southbound Skyline segment", () => {
    const s = seg(line[10], line[30]);
    expect(classifySegmentCorridor(s)).toBe("skyline");
    expect(segmentDirection(s)).toBe("south");
  });

  it("the same segment reversed is northbound", () => {
    const s = seg(line[30], line[10]);
    expect(classifySegmentCorridor(s)).toBe("skyline");
    expect(segmentDirection(s)).toBe("north");
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
