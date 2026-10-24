import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  localDate,
  todayInLA,
  weekdayShort,
  yearInLA,
} from "../dates";

describe("dates (America/Los_Angeles)", () => {
  // 6:30 pm PDT on Oct 22 is already Oct 23 in UTC — the case that broke
  // "Today" and /should-i-sf2g hydration.
  const evening = new Date("2026-10-23T01:30:00Z");

  it("todayInLA is the LA calendar date, not UTC", () => {
    expect(todayInLA(evening)).toBe("2026-10-22");
    expect(localDate(evening, "UTC")).toBe("2026-10-23");
  });

  it("yearInLA flips at LA midnight, not UTC midnight", () => {
    expect(yearInLA(new Date("2027-01-01T05:00:00Z"))).toBe(2026);
    expect(yearInLA(new Date("2027-01-01T09:00:00Z"))).toBe(2027);
  });

  it("addDays crosses month, year and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02"); // DST ends Nov 1
    expect(addDays("2026-03-08", -1)).toBe("2026-03-07"); // DST starts Mar 8
  });

  it("addMonths clamps to the end of the month", () => {
    expect(addMonths("2026-08-31", -6)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
  });

  it("weekdayShort", () => {
    expect(weekdayShort("2026-10-23")).toBe("Fri");
    expect(weekdayShort("2026-10-25")).toBe("Sun");
  });
});

describe("minutesOfDayInLA", () => {
  it("is LA wall-clock time in both DST and standard time", async () => {
    const { minutesOfDayInLA } = await import("../dates");
    expect(minutesOfDayInLA("2026-07-01T13:30:00Z")).toBe(6 * 60 + 30); // PDT
    expect(minutesOfDayInLA("2026-12-01T14:15:00Z")).toBe(6 * 60 + 15); // PST
  });
});
