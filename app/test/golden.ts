/**
 * JSON goldens with numeric tolerance.
 *
 * Postgres sums `real` (float4) columns in no guaranteed order, so aggregates
 * wobble in the last bits between runs; string snapshots of rounded values
 * flake whenever a value sits on a rounding boundary. Goldens are compared
 * structurally instead: numbers within RELATIVE_TOLERANCE are equal, anything
 * else produces a normal readable diff.
 *
 * One golden file per test file: `__goldens__/<test file>.json`, keyed by test
 * name. Run with SF2G_UPDATE_GOLDENS=1 to rewrite them (review the diff!).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterAll, expect } from "vitest";
import { normalize } from "./normalize";

const RELATIVE_TOLERANCE = 1e-6;
const ABSOLUTE_TOLERANCE = 1e-6;

const UPDATE = process.env.SF2G_UPDATE_GOLDENS === "1";

type GoldenFile = {
  path: string;
  data: Record<string, unknown>;
  dirty: boolean;
};
const files = new Map<string, GoldenFile>();

function fileFor(testPath: string): GoldenFile {
  let f = files.get(testPath);
  if (!f) {
    const path = join(
      dirname(testPath),
      "__goldens__",
      `${basename(testPath)}.json`,
    );
    const data = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
      : {};
    f = { path, data, dirty: false };
    files.set(testPath, f);
  }
  return f;
}

// Registered when a test file imports this module (collection time), so it
// runs once after all of that file's tests.
afterAll(() => {
  for (const f of files.values()) {
    if (!f.dirty) continue;
    mkdirSync(dirname(f.path), { recursive: true });
    const sorted = Object.fromEntries(
      Object.keys(f.data)
        .sort()
        .map((k) => [k, f.data[k]]),
    );
    writeFileSync(f.path, JSON.stringify(sorted, null, 2) + "\n");
    f.dirty = false;
  }
});

function close(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  return (
    diff <= ABSOLUTE_TOLERANCE ||
    diff <= RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b))
  );
}

/**
 * Return `actual` with every number that is within tolerance of the
 * corresponding expected number replaced by the expected one, so a deep
 * equality check only reports real differences.
 */
export function alignNumbers(actual: unknown, expected: unknown): unknown {
  if (typeof actual === "number" && typeof expected === "number") {
    return close(actual, expected) ? expected : actual;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.map((v, i) => alignNumbers(v, expected[i]));
  }
  if (
    actual &&
    expected &&
    typeof actual === "object" &&
    typeof expected === "object"
  ) {
    return Object.fromEntries(
      Object.entries(actual as Record<string, unknown>).map(([k, v]) => [
        k,
        alignNumbers(v, (expected as Record<string, unknown>)[k]),
      ]),
    );
  }
  return actual;
}

/** Compare `value` (normalized) with the stored golden for the current test. */
export function expectGolden(value: unknown): void {
  const state = expect.getState();
  const testPath = state.testPath!;
  const name = state.currentTestName!;
  const f = fileFor(testPath);
  // Round-trip through JSON so stored and fresh values have the same shape.
  const actual = JSON.parse(JSON.stringify(normalize(value, 9)) ?? "null");

  if (UPDATE || !(name in f.data)) {
    if (!UPDATE && process.env.CI) {
      throw new Error(
        `Missing golden for "${name}" — run SF2G_UPDATE_GOLDENS=1 pnpm test:db locally`,
      );
    }
    f.data[name] = actual;
    f.dirty = true;
    return;
  }
  const expected = f.data[name];
  expect(alignNumbers(actual, expected)).toEqual(expected);
}
