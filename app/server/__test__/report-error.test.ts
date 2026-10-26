/**
 * Phase 08: server-side error capture never throws, never records expected
 * failures, and cannot spend the subrequest budget in a hot loop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "@tanstack/react-router";
import {
  captureErrors,
  REPORT_THROTTLE,
  reportErrorWith,
  resetReportThrottle,
  toAppErrorRow,
  type AppErrorRow,
} from "../report-error";
import { ExpectedError } from "../../lib/errors";

function deps(over: Partial<Parameters<typeof reportErrorWith>[0]> = {}) {
  const rows: AppErrorRow[] = [];
  const log = vi.fn();
  return {
    rows,
    log,
    deps: {
      insert: async (row: AppErrorRow) => {
        rows.push(row);
        return { error: null };
      },
      now: () => 1_000_000,
      log,
      ...over,
    },
  };
}

beforeEach(() => resetReportThrottle());

describe("toAppErrorRow", () => {
  it("stores message, stack, fingerprint and sanitized context", () => {
    const err = new Error("get_leaderboard failed: 57014 timeout");
    const row = toAppErrorRow("fn:fetchLeaderboard", err, {
      userId: "u-1",
      requestUrl: "/leaderboard?datePreset=this-week",
      query: { sort: "sf2g_total" },
    });
    expect(row).toMatchObject({
      scope: "fn:fetchLeaderboard",
      message: "get_leaderboard failed: 57014 timeout",
      user_id: "u-1",
      request_url: "/leaderboard?datePreset=this-week",
      context: { query: { sort: "sf2g_total" } },
    });
    expect(row.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(row.stack).toContain("Error: get_leaderboard failed");
  });

  it("truncates huge messages and stacks", () => {
    const row = toAppErrorRow("x", new Error("m".repeat(5_000)));
    expect(row.message.length).toBeLessThanOrEqual(1_000);
    expect((row.stack ?? "").length).toBeLessThanOrEqual(4_000);
  });
});

describe("reportErrorWith", () => {
  it("records an unexpected error and logs it", async () => {
    const d = deps();
    const outcome = await reportErrorWith(
      d.deps,
      "scheduled",
      new Error("boom"),
    );
    expect(outcome).toBe("recorded");
    expect(d.rows).toHaveLength(1);
    expect(d.log).toHaveBeenCalledWith(
      "[error] scheduled: boom",
      expect.stringContaining("Error: boom"),
    );
  });

  it("skips expected errors without logging or writing", async () => {
    const d = deps();
    expect(await reportErrorWith(d.deps, "fn:x", new Error("Forbidden"))).toBe(
      "expected",
    );
    expect(
      await reportErrorWith(d.deps, "fn:x", new ExpectedError("bad input")),
    ).toBe("expected");
    expect(
      await reportErrorWith(d.deps, "fn:x", redirect({ href: "/leaderboard" })),
    ).toBe("expected");
    expect(d.rows).toHaveLength(0);
    expect(d.log).not.toHaveBeenCalled();
  });

  it("never throws when the insert fails", async () => {
    const d = deps({
      insert: async () => {
        throw new Error("network down");
      },
    });
    expect(await reportErrorWith(d.deps, "api/cron", new Error("x"))).toBe(
      "failed",
    );
    const d2 = deps({ insert: async () => ({ error: { message: "42501" } }) });
    expect(await reportErrorWith(d2.deps, "api/cron", new Error("x"))).toBe(
      "failed",
    );
  });

  it("throttles after MAX_PER_WINDOW writes and recovers next window", async () => {
    let now = 0;
    const d = deps({ now: () => now });
    for (let i = 0; i < REPORT_THROTTLE.MAX_PER_WINDOW; i++) {
      expect(await reportErrorWith(d.deps, "loop", new Error(`e${i}`))).toBe(
        "recorded",
      );
    }
    expect(
      await reportErrorWith(d.deps, "loop", new Error("one too many")),
    ).toBe("throttled");
    expect(d.rows).toHaveLength(REPORT_THROTTLE.MAX_PER_WINDOW);
    // Still logged, so Workers logs keep the full picture.
    expect(d.log).toHaveBeenCalledTimes(REPORT_THROTTLE.MAX_PER_WINDOW + 1);

    now += REPORT_THROTTLE.WINDOW_MS;
    expect(
      await reportErrorWith(d.deps, "loop", new Error("next window")),
    ).toBe("recorded");
  });
});

describe("captureErrors", () => {
  it("returns the value when fn succeeds and reports nothing", async () => {
    const report = vi.fn();
    const value = await captureErrors("fn:ok", async () => 42, {}, report);
    expect(value).toBe(42);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports with lazy context, then rethrows the original error", async () => {
    const report = vi.fn(async () => "recorded" as const);
    const boom = new TypeError("x is not a function");
    await expect(
      captureErrors(
        "fn:fetchRides",
        async () => {
          throw boom;
        },
        () => ({ requestUrl: "/rides" }),
        report,
      ),
    ).rejects.toBe(boom);
    expect(report).toHaveBeenCalledWith("fn:fetchRides", boom, {
      requestUrl: "/rides",
    });
  });
});
