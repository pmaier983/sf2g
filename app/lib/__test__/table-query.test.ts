import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_QUERY,
  effectiveDateRange,
  hasActiveFilters,
  localDate,
  parseSearch,
  patchQuery,
  resolveDateRange,
  serializeSearch,
  type TableQuery,
} from "../table-query";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("parseSearch", () => {
  it("defaults everything for an empty URL", () => {
    expect(parseSearch({})).toEqual(DEFAULT_TABLE_QUERY);
  });

  it("never throws on garbage, falling back per field", () => {
    const q = parseSearch({
      view: "bogus",
      routes: "skyline,nope,skyline",
      ppr: "maybe",
      company: "acme",
      user: "not-a-uuid",
      page: "-4", // no longer a param: ignored
      sort: "drop table",
      dir: "sideways",
      datePreset: "next-week",
      dateFrom: "yesterday",
      density: 7,
      duration: "forever",
    });
    expect(q).toEqual({ ...DEFAULT_TABLE_QUERY, routes: ["skyline"] });
  });

  it("validates sort against the current view", () => {
    expect(parseSearch({ view: "rides", sort: "sf2g_total" }).sort).toBe(
      "ride_date",
    );
    expect(
      parseSearch({ view: "rides", sort: "distance_meters", dir: "asc" }),
    ).toMatchObject({ sort: "distance_meters", dir: "asc" });
    expect(parseSearch({ view: "groups", sort: "routeCategory" }).sort).toBe(
      "date",
    );
  });

  it("maps legacy per-view sort params", () => {
    expect(
      parseSearch({ view: "rides", rSort: "name", rDir: "asc" }),
    ).toMatchObject({ view: "rides", sort: "name", dir: "asc" });
    expect(
      parseSearch({
        view: "groups",
        gSort: "riderCount",
        gDir: "asc",
        gPage: 3,
      }),
    ).toMatchObject({
      view: "groups",
      sort: "riderCount",
      dir: "asc",
    });
    // Legacy params for another view are ignored
    expect(parseSearch({ view: "riders", rSort: "name" }).sort).toBe(
      "sf2g_total",
    );
  });

  it("parses a legacy shared link", () => {
    const q = parseSearch({
      routes: "skyline,bayway",
      ppr: "true",
      view: "groups",
      gSort: "date",
      datePreset: "this-week",
      dateFrom: "2026-10-12",
      dateTo: "2026-10-18",
    });
    expect(q).toMatchObject({
      routes: ["skyline", "bayway"],
      ppr: true,
      view: "groups",
      sort: "date",
      datePreset: "this-week",
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it("accepts booleans and arrays from in-app navigation", () => {
    expect(
      parseSearch({ ppr: true, routes: ["hmbw"], user: UUID }),
    ).toMatchObject({ ppr: true, routes: ["hmbw"], user: UUID });
  });
});

describe("serializeSearch", () => {
  it("omits every default", () => {
    expect(serializeSearch(DEFAULT_TABLE_QUERY)).toEqual({});
  });

  it("round-trips every field", () => {
    const q: TableQuery = {
      view: "rides",
      routes: ["skyline", "bayway"],
      search: "ada",
      ppr: true,
      other: true,
      weekends: true,
      reverse: true,
      company: "google",
      user: UUID,
      datePreset: undefined,
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      duration: "1y",
      chart: true,
      density: "condensed",
      sort: "average_speed_mps",
      dir: "asc",
    };
    const url = serializeSearch(q);
    expect(url.routes).toBe("skyline,bayway");
    expect(parseSearch(url)).toEqual(q);
    const withPreset = {
      ...q,
      datePreset: "this-year" as const,
      dateFrom: undefined,
      dateTo: undefined,
    };
    expect(parseSearch(serializeSearch(withPreset))).toEqual(withPreset);
  });

  it("keeps a non-default dir even when the sort column is the default", () => {
    const q = { ...DEFAULT_TABLE_QUERY, dir: "asc" as const };
    expect(serializeSearch(q)).toEqual({ sort: "sf2g_total", dir: "asc" });
  });
});

describe("patchQuery", () => {
  it("resets sort to the new view's default when switching views", () => {
    const q = patchQuery(
      { ...DEFAULT_TABLE_QUERY, sort: "total_rides" },
      { view: "groups" },
    );
    expect(q).toMatchObject({ view: "groups", sort: "date", dir: "desc" });
  });

  it("a preset clears custom dates and custom dates clear the preset", () => {
    const custom = patchQuery(DEFAULT_TABLE_QUERY, {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    const preset = patchQuery(custom, { datePreset: "today" });
    expect(preset).toMatchObject({
      datePreset: "today",
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(patchQuery(preset, { dateFrom: "2026-03-01" })).toMatchObject({
      datePreset: undefined,
      dateFrom: "2026-03-01",
    });
  });
});

describe("hasActiveFilters", () => {
  it("is false only for the defaults", () => {
    expect(hasActiveFilters(DEFAULT_TABLE_QUERY)).toBe(false);
    expect(
      hasActiveFilters({
        ...DEFAULT_TABLE_QUERY,
        view: "groups",
        sort: "date",
      }),
    ).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_TABLE_QUERY, dir: "asc" })).toBe(true);
  });
});

describe("dates in America/Los_Angeles", () => {
  // 2026-10-23 is a Friday. 06:30 UTC is still Thursday evening in LA.
  const thuEveningLA = new Date("2026-10-23T06:30:00Z");

  it("uses the LA calendar date regardless of the machine's zone", () => {
    expect(localDate(thuEveningLA)).toBe("2026-10-22");
    expect(localDate(thuEveningLA, "Pacific/Kiritimati")).toBe("2026-10-23");
  });

  it("resolves every preset", () => {
    const now = thuEveningLA;
    expect(resolveDateRange("today", now)).toEqual({
      from: "2026-10-22",
      to: "2026-10-22",
    });
    expect(resolveDateRange("this-week", now)).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    });
    expect(resolveDateRange("last-30-days", now)).toEqual({
      from: "2026-09-22",
      to: "2026-10-22",
    });
    expect(resolveDateRange("this-month", now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-22",
    });
    expect(resolveDateRange("last-6-months", now)).toEqual({
      from: "2026-04-22",
      to: "2026-10-22",
    });
    expect(resolveDateRange("last-365-days", now)).toEqual({
      from: "2025-10-22",
      to: "2026-10-22",
    });
    expect(resolveDateRange("this-year", now)).toEqual({
      from: "2026-01-01",
      to: "2026-10-22",
    });
  });

  it("week starts Monday; Sunday belongs to the previous week", () => {
    const sundayLA = new Date("2026-10-25T20:00:00Z");
    expect(resolveDateRange("this-week", sundayLA)).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    });
  });

  it("clamps month arithmetic to the month's last day", () => {
    expect(
      resolveDateRange("last-6-months", new Date("2026-08-31T20:00:00Z")).from,
    ).toBe("2026-02-28");
  });

  it("effectiveDateRange prefers the preset", () => {
    expect(
      effectiveDateRange(
        { datePreset: "today", dateFrom: "2020-01-01", dateTo: undefined },
        thuEveningLA,
      ),
    ).toEqual({
      dateFrom: "2026-10-22",
      dateTo: "2026-10-22",
    });
    expect(
      effectiveDateRange({
        datePreset: undefined,
        dateFrom: "2020-01-01",
        dateTo: undefined,
      }),
    ).toEqual({
      dateFrom: "2020-01-01",
      dateTo: undefined,
    });
  });
});
