import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_SORT_COLUMNS,
  parseLeaderboardQuery,
  toLeaderboardSqlParams,
} from "../leaderboard-query";

describe("parseLeaderboardQuery", () => {
  it("fills defaults (weekends excluded, sorted by SF2G total desc)", () => {
    expect(parseLeaderboardQuery({})).toEqual({
      routes: [],
      includeOther: false,
      dateFrom: undefined,
      dateTo: undefined,
      excludeWeekends: true,
      ppr: false,
      reverse: false,
      company: undefined,
      search: undefined,
      sort: "sf2g_total",
      dir: "desc",
    });
  });

  it("falls back instead of throwing on bad input", () => {
    const q = parseLeaderboardQuery({
      routes: ["skyline", "nope", "skyline"],
      dateFrom: "2026-13-99x",
      company: "ACME'; drop table rides; --",
      sort: "sf2g_total; drop table rides",
      dir: "sideways",
      excludeWeekends: "yes",
    });
    expect(q.routes).toEqual(["skyline"]);
    expect(q.dateFrom).toBeUndefined();
    expect(q.company).toBeUndefined();
    expect(q.sort).toBe("sf2g_total");
    expect(q.dir).toBe("desc");
    expect(q.excludeWeekends).toBe(true);
  });

  it("accepts every sortable column the table can request", () => {
    for (const sort of LEADERBOARD_SORT_COLUMNS) {
      expect(parseLeaderboardQuery({ sort }).sort).toBe(sort);
    }
  });

  it("maps to get_leaderboard's snake_case params", () => {
    expect(
      toLeaderboardSqlParams(
        parseLeaderboardQuery({
          routes: ["skyline"],
          ppr: true,
          search: "  ada ",
        }),
      ),
    ).toMatchObject({
      routes: ["skyline"],
      ppr: true,
      search: "ada",
      exclude_weekends: true,
    });
  });
});
