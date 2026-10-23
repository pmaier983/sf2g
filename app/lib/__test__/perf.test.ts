import { describe, it, expect, vi, afterEach } from "vitest";
import { trackSubrequests } from "../perf";

describe("trackSubrequests", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("counts fetches made inside the callback and restores fetch", async () => {
    const fake = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fake as unknown as typeof fetch;

    const { result, subrequests } = await trackSubrequests(async (count) => {
      await fetch("https://a");
      await fetch("https://b");
      return count();
    });

    expect(result).toBe(2);
    expect(subrequests).toBe(2);
    expect(fake).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toBe(fake);
  });

  it("restores fetch even when the callback throws", async () => {
    const fake = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fake as unknown as typeof fetch;
    await expect(
      trackSubrequests(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(globalThis.fetch).toBe(fake);
  });
});
