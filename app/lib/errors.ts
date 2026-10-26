/**
 * Error helpers shared by the server error reporter and the client tracker.
 * Pure: no I/O, safe to import anywhere.
 */
import { isNotFound, isRedirect } from "@tanstack/react-router";

export const ERROR_MESSAGE_MAX = 1_000;
export const ERROR_STACK_MAX = 4_000;
export const ERROR_CONTEXT_MAX = 2_000;

/** Human-readable message for anything that was thrown. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

export function errorStack(err: unknown): string | undefined {
  return err instanceof Error && err.stack ? err.stack : undefined;
}

/**
 * Throw this (or set `expected = true` on any error) for failures that are
 * part of normal operation — bad input, a signed-out user, a denied admin
 * action. They reach the caller like any error but are not recorded.
 */
export class ExpectedError extends Error {
  readonly expected = true;
  constructor(message: string) {
    super(message);
    this.name = "ExpectedError";
  }
}

/** Messages thrown today by existing code that mean "not a bug". */
const EXPECTED_MESSAGES = new Set([
  "Forbidden",
  "Not authenticated",
  "Unauthorized",
]);

export function isExpectedError(err: unknown): boolean {
  if (!err) return true;
  if (isRedirect(err) || isNotFound(err)) return true;
  if (
    typeof err === "object" &&
    (err as { expected?: unknown }).expected === true
  )
    return true;
  const message = errorMessage(err);
  if (EXPECTED_MESSAGES.has(message)) return true;
  // OAuth consent problems are the rider's choice, not a defect.
  if (message.startsWith("INSUFFICIENT_SCOPES:")) return true;
  return false;
}

/**
 * Strip the parts of a message that vary per occurrence (ids, numbers,
 * quoted values) so one bug has one fingerprint.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<uuid>",
    )
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Stable short hash (djb2) of scope + normalized message. */
export function errorFingerprint(scope: string, message: string): string {
  const input = `${scope}\n${normalizeMessage(message)}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** JSON-safe, size-capped copy of arbitrary context. */
export function sanitizeContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!context) return {};
  let json: string;
  try {
    json = JSON.stringify(context, (_key, value) => {
      if (value instanceof Error) return { message: value.message };
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "function") return undefined;
      return value;
    });
  } catch {
    return { unserializable: true };
  }
  if (!json || json === "{}") return {};
  if (json.length <= ERROR_CONTEXT_MAX) return JSON.parse(json);
  return { truncated: json.slice(0, ERROR_CONTEXT_MAX) };
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
