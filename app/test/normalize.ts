import { createHash } from "node:crypto";

/** Strings longer than this (encoded polylines, raw payloads) are summarized. */
const MAX_STRING = 120;

/** Timestamps written by the database at refresh/compute time. */
const VOLATILE_KEYS = new Set(["computed_at", "computedAt", "fetched_at"]);

/**
 * Make server-function output stable and reviewable for snapshots: round
 * non-integer numbers (float4 columns and SQL vs JS aggregation differ in the
 * last bits), replace long strings with a length + hash stand-in, and sort
 * object keys. Arrays keep their order — ordering is part of the contract.
 */
export function normalize(value: unknown, decimals = 3): unknown {
  if (typeof value === "string" && value.length > MAX_STRING) {
    const hash = createHash("sha1").update(value).digest("hex").slice(0, 10);
    return `<string len=${value.length} sha1=${hash}>`;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) || !Number.isFinite(value)) return value;
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v, decimals));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [
          k,
          VOLATILE_KEYS.has(k)
            ? "<volatile>"
            : normalize((value as Record<string, unknown>)[k], decimals),
        ]),
    );
  }
  return value;
}
