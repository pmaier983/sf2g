/**
 * The SQL ports in migration 037 must agree with the TypeScript they replace,
 * ride by ride, on the whole fixture dataset plus targeted edge cases.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { getCommuteDirection } from "../../../lib/route-classifier";
import { isPprDawnReference } from "../../../test/reference/ppr-dawn";
import { decodePolyline } from "../../../lib/polyline";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);

interface RideRow {
  id: string;
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
  commute_direction: string | null;
  is_ppr_dawn: boolean;
  summary_polyline: string | null;
  start_date: string;
  timezone: string | null;
  moving_time_seconds: number | null;
}

async function allRides(): Promise<RideRow[]> {
  const { data, error } = await db
    .from("rides")
    .select(
      "id, start_latlng, end_latlng, commute_direction, is_ppr_dawn, summary_polyline, start_date, timezone, moving_time_seconds",
    )
    .order("id");
  if (error) throw error;
  return data as RideRow[];
}

describe("commute_direction (generated column) = getCommuteDirection()", () => {
  it("agrees on every fixture ride", async () => {
    const rides = await allRides();
    const mismatches = rides.filter(
      (r) =>
        (getCommuteDirection(r.start_latlng, r.end_latlng) ?? null) !==
        r.commute_direction,
    );
    expect(mismatches.map((r) => r.id)).toEqual([]);
    expect(rides.some((r) => r.commute_direction === "g2sf")).toBe(true);
    expect(rides.some((r) => r.commute_direction === "sf2g")).toBe(true);
  });

  it("agrees on edge points (bounds, polygon edges, missing data)", async () => {
    const cases: Array<[unknown, unknown]> = [
      [
        [37.7749, -122.4194],
        [37.4419, -122.143],
      ], // SF → Palo Alto
      [
        [37.4419, -122.143],
        [37.7749, -122.4194],
      ], // Palo Alto → SF
      [
        [37.82, -122.34],
        [37.25, -121.85],
      ], // SF corner → corridor corner
      [
        [37.7, -122.52],
        [37.69, -122.54],
      ], // SF SW corner → corridor NW vertex
      [
        [37.8044, -122.2712],
        [37.4419, -122.143],
      ], // Oakland → Palo Alto (neither)
      [null, [37.4419, -122.143]],
      [[37.7749], [37.4419, -122.143]],
    ];
    for (const [start, end] of cases) {
      const { data, error } = await db.rpc(
        "sf2g_commute_direction" as never,
        {
          start_latlng: start,
          end_latlng: end,
        } as never,
      );
      expect(error).toBeNull();
      const ts =
        Array.isArray(start) &&
        start.length >= 2 &&
        Array.isArray(end) &&
        end.length >= 2
          ? getCommuteDirection(
              start as [number, number],
              end as [number, number],
            )
          : null;
      expect([start, end, data]).toEqual([start, end, ts]);
    }
  });
});

describe("sf2g_decode_polyline = @mapbox/polyline", () => {
  it("decodes every fixture polyline identically", async () => {
    const rides = (await allRides())
      .filter((r) => r.summary_polyline)
      .slice(0, 40);
    for (const r of rides) {
      const { data, error } = await db.rpc(
        "sf2g_decode_polyline" as never,
        {
          encoded: r.summary_polyline,
        } as never,
      );
      expect(error).toBeNull();
      const sql = (data as Array<{ lat: number; lng: number }>).map((p) => [
        p.lat,
        p.lng,
      ]);
      expect(sql).toEqual(decodePolyline(r.summary_polyline!));
    }
  });
});

describe("is_ppr_dawn (trigger) = pre-037 TypeScript rule", () => {
  it("agrees on every fixture ride", async () => {
    const rides = await allRides();
    const mismatches = rides.filter(
      (r) => isPprDawnReference(r) !== r.is_ppr_dawn,
    );
    expect(mismatches.map((r) => r.id)).toEqual([]);
    const flagged = rides.filter((r) => r.is_ppr_dawn).length;
    expect(flagged).toBeGreaterThan(0);
    expect(flagged).toBeLessThan(rides.length);
  });

  it("is recomputed when a ride's timing changes", async () => {
    const [ride] = (await allRides()).filter((r) => r.is_ppr_dawn);
    const later = new Date(
      new Date(ride.start_date).getTime() + 3 * 3600_000,
    ).toISOString();
    try {
      await db.from("rides").update({ start_date: later }).eq("id", ride.id);
      const { data } = await db
        .from("rides")
        .select("is_ppr_dawn")
        .eq("id", ride.id)
        .single();
      expect(data?.is_ppr_dawn).toBe(false);
    } finally {
      await db
        .from("rides")
        .update({ start_date: ride.start_date })
        .eq("id", ride.id);
    }
    const { data } = await db
      .from("rides")
      .select("is_ppr_dawn")
      .eq("id", ride.id)
      .single();
    expect(data?.is_ppr_dawn).toBe(true);
  });
});
