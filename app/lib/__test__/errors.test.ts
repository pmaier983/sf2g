import { describe, expect, it } from "vitest";
import { notFound, redirect } from "@tanstack/react-router";
import {
  ExpectedError,
  errorFingerprint,
  errorMessage,
  isExpectedError,
  normalizeMessage,
  sanitizeContext,
} from "../errors";

describe("errorMessage", () => {
  it("reads Errors, strings and message-shaped objects", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ message: "from postgrest", code: "42P01" })).toBe(
      "from postgrest",
    );
    expect(errorMessage(null)).toBe("null");
  });
});

describe("isExpectedError", () => {
  it("treats router redirects and not-found as expected", () => {
    expect(isExpectedError(redirect({ href: "/leaderboard" }))).toBe(true);
    expect(isExpectedError(notFound())).toBe(true);
  });

  it("treats auth gates and ExpectedError as expected, bugs as not", () => {
    expect(isExpectedError(new Error("Forbidden"))).toBe(true);
    expect(isExpectedError(new Error("Not authenticated"))).toBe(true);
    expect(isExpectedError(new ExpectedError("bad date range"))).toBe(true);
    expect(
      isExpectedError(new Error("INSUFFICIENT_SCOPES:please tick every box")),
    ).toBe(true);
    expect(isExpectedError(new TypeError("x is not a function"))).toBe(false);
    expect(isExpectedError(new Error("get_leaderboard failed: timeout"))).toBe(
      false,
    );
  });
});

describe("fingerprints", () => {
  it("ignores ids, numbers and quoted values", () => {
    const a = normalizeMessage(
      'Failed to load ride 123e4567-e89b-12d3-a456-426614174000 for "Ada" after 3 tries',
    );
    const b = normalizeMessage(
      'Failed to load ride 00000000-0000-4000-8000-000000000001 for "Bo" after 12 tries',
    );
    expect(a).toBe(b);
    expect(a).toBe('Failed to load ride <uuid> for "…" after <n> tries');
  });

  it("is stable, hex, and differs by scope", () => {
    const fp = errorFingerprint("fn:fetchLeaderboard", "timeout after 8000ms");
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(errorFingerprint("fn:fetchLeaderboard", "timeout after 100ms")).toBe(
      fp,
    );
    expect(errorFingerprint("fn:fetchRides", "timeout after 8000ms")).not.toBe(
      fp,
    );
  });
});

describe("sanitizeContext", () => {
  it("drops functions, serializes errors, caps size", () => {
    const ctx = sanitizeContext({
      fn: () => 1,
      err: new Error("inner"),
      big: "x".repeat(5_000),
    });
    expect(ctx).toHaveProperty("truncated");
    expect(sanitizeContext({ a: 1, err: new Error("inner") })).toEqual({
      a: 1,
      err: { message: "inner" },
    });
    expect(sanitizeContext(undefined)).toEqual({});
  });
});
