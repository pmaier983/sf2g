import { describe, expect, it } from "vitest";
import {
  describeDrift,
  hasDrift,
  migrationDrift,
  parseMigrationList,
} from "./migration-drift";

describe("migrationDrift", () => {
  it("reports nothing when every file is applied and nothing else is", () => {
    const drift = migrationDrift([
      { local: "001", remote: "001" },
      { local: "002", remote: "002" },
    ]);
    expect(drift).toEqual({ missing: [], extra: [] });
    expect(hasDrift(drift)).toBe(false);
  });

  it("separates files not yet applied from applied versions without a file", () => {
    // The shape seen on the shared local stack: another worktree applied
    // 043 and 045, and this checkout's 044 is not applied.
    const drift = migrationDrift([
      { local: "042", remote: "042" },
      { local: "", remote: "043" },
      { local: "044", remote: "" },
      { local: "", remote: "045" },
    ]);
    expect(drift).toEqual({ missing: ["044"], extra: ["043", "045"] });
    expect(hasDrift(drift)).toBe(true);
    expect(describeDrift(drift)).toBe(
      "not applied: 044; applied but not in this checkout: 043, 045",
    );
  });

  it("treats an empty database as missing every migration", () => {
    const drift = migrationDrift([
      { local: "001", remote: "" },
      { local: "002", remote: "" },
    ]);
    expect(drift.missing).toEqual(["001", "002"]);
    expect(drift.extra).toEqual([]);
  });
});

describe("parseMigrationList", () => {
  it("reads the JSON object after any leading progress text", () => {
    const stdout = [
      "Connecting to local database...",
      '{"migrations":[{"local":"001","remote":"001","time":"001"},{"local":"","remote":"002","time":"002"}],"message":"Migrations listed"}',
    ].join("\n");
    expect(parseMigrationList(stdout)).toEqual([
      { local: "001", remote: "001" },
      { local: "", remote: "002" },
    ]);
  });

  it("returns null when there is no JSON to read", () => {
    expect(parseMigrationList("")).toBeNull();
    expect(parseMigrationList("Connecting to local database...")).toBeNull();
    expect(parseMigrationList("{not json")).toBeNull();
    expect(parseMigrationList('{"message":"no list"}')).toBeNull();
  });
});
