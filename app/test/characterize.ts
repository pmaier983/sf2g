/**
 * Characterization ("golden") tests: pin what a server function returns today
 * for the fixture dataset, so a rewrite can prove it changed nothing by
 * accident — or name exactly what it changed on purpose.
 */
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { FIXTURE_NOW } from "./local-supabase";
import { expectGolden } from "./golden";

export const RIDER = {
  ada: "00000000-0000-4000-8000-000000000001",
  ben: "00000000-0000-4000-8000-000000000002",
  cam: "00000000-0000-4000-8000-000000000003",
  dee: "00000000-0000-4000-8000-000000000004",
  eve: "00000000-0000-4000-8000-000000000005",
  fay: "00000000-0000-4000-8000-000000000006",
  gus: "00000000-0000-4000-8000-000000000007",
  hal: "00000000-0000-4000-8000-000000000008",
  ivy: "00000000-0000-4000-8000-000000000009",
} as const;

/** Freeze `Date` (only) at FIXTURE_NOW for every test in the file. */
export function freezeFixtureClock(): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: FIXTURE_NOW });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}

/**
 * One snapshot per labeled input. `fn` errors are snapshotted too, so a path
 * that throws today is pinned as throwing.
 */
export function characterize<I>(
  name: string,
  fn: (input: I) => Promise<unknown>,
  cases: Record<string, I>,
): void {
  describe(name, () => {
    for (const [label, input] of Object.entries(cases)) {
      it(label, async () => {
        let out: unknown;
        try {
          out = await fn(input);
        } catch (err) {
          out = { __error: err instanceof Error ? err.message : String(err) };
        }
        expectGolden(out);
      });
    }
  });
}
