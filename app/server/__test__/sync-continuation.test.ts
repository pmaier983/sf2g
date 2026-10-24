import { describe, it, expect } from "vitest";
import { isAscendingByStartDate } from "../sync";

describe("isAscendingByStartDate", () => {
  it("treats empty and single-item pages as ascending", () => {
    expect(isAscendingByStartDate([])).toBe(true);
    expect(
      isAscendingByStartDate([{ start_date: "2026-10-01T13:00:00Z" }]),
    ).toBe(true);
  });

  it("detects oldest-first pages (Strava's order when `after` is set)", () => {
    expect(
      isAscendingByStartDate([
        { start_date: "2026-10-01T13:00:00Z" },
        { start_date: "2026-10-02T13:00:00Z" },
      ]),
    ).toBe(true);
  });

  it("detects newest-first pages", () => {
    expect(
      isAscendingByStartDate([
        { start_date: "2026-10-02T13:00:00Z" },
        { start_date: "2026-10-01T13:00:00Z" },
      ]),
    ).toBe(false);
  });
});
