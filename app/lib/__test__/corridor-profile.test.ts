import { describe, expect, it } from "vitest";
import profileJson from "../corridors/skyline-profile.json";
import {
  indexAtDistance,
  pointAtDistance,
  sliceRoute,
  type CorridorProfile,
} from "../corridor-profile";
import { decodePolyline } from "../polyline";
import { SKYLINE_REFERENCE_POLYLINE } from "../constants";
import { cumulativeDistances } from "../segment-corridor";
import { haversineDistance } from "../route-classifier";

const profile = profileJson as CorridorProfile;
const line = decodePolyline(SKYLINE_REFERENCE_POLYLINE);

const SLOAT_SKYLINE: [number, number] = [37.73327, -122.49734];
const ARASTRADERO: [number, number] = [37.39887, -122.13453];
const metres = (a: [number, number], b: [number, number]) =>
  haversineDistance(a[0], a[1], b[0], b[1]);

describe("skyline-profile.json", () => {
  it("has equal-length arrays and a strictly increasing distance from 0", () => {
    expect(profile.points).toBe(profile.distance.length);
    expect(profile.points).toBe(profile.altitude.length);
    expect(profile.points).toBe(profile.latlng.length);
    expect(profile.points).toBeLessThanOrEqual(600);
    expect(profile.distance[0]).toBe(0);
    for (let i = 1; i < profile.points; i++)
      expect(profile.distance[i]).toBeGreaterThan(profile.distance[i - 1]);
  });

  it("spans Sloat/Skyline → Arastradero, matching the reference line", () => {
    expect(metres(profile.latlng[0], SLOAT_SKYLINE)).toBeLessThan(300);
    expect(metres(profile.latlng.at(-1)!, ARASTRADERO)).toBeLessThan(300);
    const lineLength = cumulativeDistances(line).at(-1)!;
    const routeLength = profile.distance.at(-1)!;
    expect(Math.abs(routeLength - lineLength) / lineLength).toBeLessThan(0.05);
  });

  it("has plausible Skyline elevations", () => {
    expect(Math.min(...profile.altitude)).toBeGreaterThan(0);
    expect(Math.max(...profile.altitude)).toBeGreaterThan(150);
    expect(Math.max(...profile.altitude)).toBeLessThan(800);
  });
});

describe("profile helpers", () => {
  it("indexAtDistance / pointAtDistance interpolate between samples", () => {
    const i = 10;
    const mid = (profile.distance[i] + profile.distance[i + 1]) / 2;
    expect(indexAtDistance(profile, mid)).toBe(i);
    expect(indexAtDistance(profile, -5)).toBe(0);
    expect(indexAtDistance(profile, 1e9)).toBe(profile.points - 1);
    const p = pointAtDistance(profile, mid);
    expect(p.altitude).toBeCloseTo(
      (profile.altitude[i] + profile.altitude[i + 1]) / 2,
      5,
    );
  });

  it("sliceRoute returns the route between two distances", () => {
    const from = profile.distance[20] + 1;
    const to = profile.distance[30] - 1;
    const slice = sliceRoute(profile, from, to);
    expect(slice.length).toBe(2 + (30 - 21));
    expect(metres(slice[1], profile.latlng[21])).toBeLessThan(0.01);
    expect(metres(slice.at(-1)!, profile.latlng[30])).toBeLessThan(50);
  });
});
