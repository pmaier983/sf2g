import { describe, it, expect } from "vitest";
import { parseRateLimitHeaders, isApproachingLimit } from "../rate-limiter";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("parseRateLimitHeaders", () => {
  it("returns null without usage headers", () => {
    expect(parseRateLimitHeaders(h({}))).toBeNull();
  });

  it("checks read usage against the read limit, not the overall one", () => {
    // 90/100 reads in 15 min is over the 85% margin even though 90 < 0.85 * 200.
    const parsed = parseRateLimitHeaders(
      h({ "X-RateLimit-Usage": "90,300", "X-ReadRateLimit-Usage": "90,300" }),
    );
    expect(parsed?.isShortExceeded).toBe(true);
    expect(parsed?.shortLimit).toBe(100);
  });

  it("uses limits reported by Strava when present", () => {
    const parsed = parseRateLimitHeaders(
      h({
        "X-ReadRateLimit-Usage": "90,300",
        "X-ReadRateLimit-Limit": "300,3000",
      }),
    );
    expect(parsed?.isShortExceeded).toBe(false);
    expect(parsed?.shortLimit).toBe(300);
  });

  it("flags the daily read bucket", () => {
    expect(
      isApproachingLimit(
        h({ "X-RateLimit-Usage": "5,900", "X-ReadRateLimit-Usage": "5,900" }),
      ),
    ).toBe(true);
  });

  it("is fine well under every limit", () => {
    expect(
      isApproachingLimit(
        h({ "X-RateLimit-Usage": "10,100", "X-ReadRateLimit-Usage": "10,100" }),
      ),
    ).toBe(false);
  });
});
