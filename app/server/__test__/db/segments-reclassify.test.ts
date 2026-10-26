/**
 * Phase 07c: the reference line now runs Mussel Rock → Arastradero, so
 * segments stored by 07a (shorter line, latitude-based direction) are
 * reclassified once by an admin action. Also: the board JSON carries each
 * segment's endpoints for the route view.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { decodePolyline } from "../../../lib/polyline";
import { SKYLINE_REFERENCE_POLYLINE } from "../../../lib/constants";
import { trackSubrequests } from "../../../lib/perf";
import { reclassifySegmentCorridorsImpl } from "../../segments-admin";
import { fetchSegmentLeaderboardImpl } from "../../segments";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
const TAIL_ID = 880_001;
const OFF_ID = 880_002;

const line = decodePolyline(SKYLINE_REFERENCE_POLYLINE);
const east = ([lat, lng]: [number, number], m: number): [number, number] => [
  lat,
  lng + m / (111_320 * Math.cos((lat * Math.PI) / 180)),
];

/** Two vertices on the Woodside → Sand Hill stretch, where the route heads north-east. */
function tailPair(): [[number, number], [number, number]] {
  for (let i = 0; i < line.length; i++)
    for (let j = i + 1; j < Math.min(i + 8, line.length); j++)
      if (line[i][1] > -122.25 && line[j][0] > line[i][0] + 0.002)
        return [line[i], line[j]];
  throw new Error("no north-east stretch on the reference line");
}

function segmentRow(
  id: number,
  start: [number, number],
  end: [number, number],
) {
  return {
    id,
    name: `Reclassify test ${id}`,
    distance_meters: 1200,
    average_grade: 3,
    start_latlng: start,
    end_latlng: end,
    // As 07a stored them: off its 26.6 km line, direction by latitude.
    corridor: null,
    direction: "north",
  };
}

async function row(id: number) {
  const { data } = await db
    .from("segments")
    .select("corridor, direction")
    .eq("id", id)
    .single();
  return data;
}

async function runToEnd(pageSize?: number) {
  let cursor: number | null = null;
  let scanned = 0;
  let changed = 0;
  let calls = 0;
  do {
    const r = await reclassifySegmentCorridorsImpl({
      cursor,
      pageSize,
      maxPages: pageSize ? 1 : undefined,
    });
    scanned += r.scanned;
    changed += r.changed;
    cursor = r.nextCursor;
    calls++;
  } while (cursor !== null && calls < 50);
  return { scanned, changed, calls };
}

describe("reclassifySegmentCorridors", () => {
  beforeAll(async () => {
    const [a, b] = tailPair();
    const { error } = await db
      .from("segments")
      .insert([
        segmentRow(TAIL_ID, a, b),
        segmentRow(OFF_ID, east(a, 2000), east(b, 2000)),
      ]);
    if (error) throw new Error(`insert segments: ${error.message}`);
  });

  afterAll(async () => {
    await db.from("segments").delete().in("id", [TAIL_ID, OFF_ID]);
  });

  it("puts tail segments on the corridor, southbound; leaves off-route ones alone", async () => {
    const first = await runToEnd();
    expect(first.changed).toBeGreaterThanOrEqual(1);
    expect(await row(TAIL_ID)).toEqual({
      corridor: "skyline",
      direction: "south",
    });
    expect(await row(OFF_ID)).toEqual({ corridor: null, direction: "north" });

    // Fixture segments were generated with the same rules: nothing else moves,
    // and a second pass changes nothing.
    const fixture = await db
      .from("segments")
      .select("id, corridor, direction")
      .gte("id", 900_001)
      .lte("id", 900_008)
      .order("id");
    expect(fixture.data!.map((s) => [s.corridor, s.direction])).toEqual([
      ["skyline", "south"],
      ["skyline", "south"],
      ["skyline", "south"],
      ["skyline", "south"],
      ["skyline", "south"],
      ["skyline", "south"],
      ["skyline", "north"],
      [null, "south"],
    ]);
    expect((await runToEnd()).changed).toBe(0);
  });

  it("pages by id with a cursor, two requests per page at most", async () => {
    const { data: all } = await db
      .from("segments")
      .select("id", { count: "exact" });
    const total = all!.length;
    const paged = await runToEnd(3);
    expect(paged.scanned).toBe(total);
    expect(paged.calls).toBe(Math.ceil((total + 1) / 3));

    await db.from("segments").update({ direction: "north" }).eq("id", TAIL_ID);
    const { result, subrequests } = await trackSubrequests(() =>
      reclassifySegmentCorridorsImpl({
        cursor: TAIL_ID - 1,
        pageSize: 1,
        maxPages: 1,
      }),
    );
    expect(result).toEqual({ scanned: 1, changed: 1, nextCursor: TAIL_ID });
    expect(subrequests).toBe(2);
  });
});

describe("get_segment_leaderboard — endpoints for the route view", () => {
  it("each segment carries start_latlng and end_latlng", async () => {
    const board = await fetchSegmentLeaderboardImpl({});
    expect(board.segments.length).toBeGreaterThan(0);
    for (const s of board.segments) {
      expect(s.start_latlng).toHaveLength(2);
      expect(s.end_latlng).toHaveLength(2);
    }
    const { data } = await db
      .from("segments")
      .select("start_latlng, end_latlng")
      .eq("id", board.segments[0].id)
      .single();
    expect(board.segments[0].start_latlng).toEqual(data!.start_latlng);
    expect(board.segments[0].end_latlng).toEqual(data!.end_latlng);
  });
});
