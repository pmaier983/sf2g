/**
 * Server-side error capture.
 *
 * Every failure the Worker catches — a server function throwing, an API route
 * crashing, a Cron tick failing — goes through `reportError`: one structured
 * `console.error` line (Workers logs, 3-day retention) and one row in
 * `app_errors` (migration 044, 90-day retention, grouped in DevTools and
 * counted in the monthly report).
 *
 * Rules:
 * - Never throws, never blocks the caller for long: one Supabase insert
 *   (one subrequest) on the error path only.
 * - Expected failures (`isExpectedError`: redirects, auth gates,
 *   `ExpectedError`) are not recorded.
 * - Throttled per isolate so a hot loop can't spend the subrequest budget
 *   or flood the table.
 */
import {
  ERROR_MESSAGE_MAX,
  ERROR_STACK_MAX,
  errorFingerprint,
  errorMessage,
  errorStack,
  isExpectedError,
  sanitizeContext,
  truncate,
} from "../lib/errors";
import type { TablesInsert } from "../lib/database.types";

export type AppErrorRow = TablesInsert<"app_errors">;

export interface ErrorContext extends Record<string, unknown> {
  /** Rider the request belonged to, when known. */
  userId?: string | null;
  /** Request path or URL, when known. */
  requestUrl?: string | null;
}

export interface ReportErrorDeps {
  insert: (row: AppErrorRow) => Promise<{ error: { message: string } | null }>;
  now?: () => number;
  log?: (line: string, err?: unknown) => void;
}

export type ReportOutcome = "recorded" | "expected" | "throttled" | "failed";

export const REPORT_THROTTLE = {
  /** Rows written per isolate per window. */
  MAX_PER_WINDOW: 20,
  WINDOW_MS: 60_000,
} as const;

let windowStartedAt = 0;
let writtenInWindow = 0;

/** Tests only. */
export function resetReportThrottle(): void {
  windowStartedAt = 0;
  writtenInWindow = 0;
}

function takeToken(now: number): boolean {
  if (now - windowStartedAt >= REPORT_THROTTLE.WINDOW_MS) {
    windowStartedAt = now;
    writtenInWindow = 0;
  }
  if (writtenInWindow >= REPORT_THROTTLE.MAX_PER_WINDOW) return false;
  writtenInWindow++;
  return true;
}

/** Build the row that will be stored (exported for tests). */
export function toAppErrorRow(
  scope: string,
  err: unknown,
  context: ErrorContext = {},
): AppErrorRow {
  const { userId, requestUrl, ...rest } = context;
  const message = truncate(errorMessage(err), ERROR_MESSAGE_MAX);
  const stack = errorStack(err);
  return {
    scope: truncate(scope, 120),
    message,
    stack: stack ? truncate(stack, ERROR_STACK_MAX) : null,
    fingerprint: errorFingerprint(scope, message),
    context: sanitizeContext(rest) as AppErrorRow["context"],
    user_id: userId ?? null,
    request_url: requestUrl ? truncate(requestUrl, 500) : null,
  };
}

export async function reportErrorWith(
  deps: ReportErrorDeps,
  scope: string,
  err: unknown,
  context: ErrorContext = {},
): Promise<ReportOutcome> {
  const log = deps.log ?? ((line, e) => console.error(line, e ?? ""));
  if (isExpectedError(err)) return "expected";

  const row = toAppErrorRow(scope, err, context);
  log(
    `[error] ${row.scope}: ${row.message}`,
    err instanceof Error ? err.stack : undefined,
  );

  if (!takeToken((deps.now ?? Date.now)())) return "throttled";
  try {
    const { error } = await deps.insert(row);
    if (error) {
      log(`[error] could not record ${row.scope}: ${error.message}`);
      return "failed";
    }
    return "recorded";
  } catch (e) {
    log(`[error] could not record ${row.scope}: ${errorMessage(e)}`);
    return "failed";
  }
}

async function defaultInsert(row: AppErrorRow) {
  const { createServiceClient } = await import("../lib/supabase");
  return createServiceClient().from("app_errors").insert(row);
}

/**
 * Record an unexpected server-side error. Safe to call from anywhere on the
 * server; resolves once the row is written (or given up on).
 */
export async function reportError(
  scope: string,
  err: unknown,
  context: ErrorContext = {},
): Promise<ReportOutcome> {
  try {
    return await reportErrorWith(
      { insert: defaultInsert },
      scope,
      err,
      context,
    );
  } catch {
    return "failed";
  }
}

/**
 * Run `fn`; if it throws, record the error under `scope` and rethrow.
 * Used by the Start middleware for every server function and request.
 */
export async function captureErrors<T>(
  scope: string,
  fn: () => Promise<T>,
  context: ErrorContext | (() => ErrorContext) = {},
  report: typeof reportError = reportError,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await report(
      scope,
      err,
      typeof context === "function" ? context() : context,
    );
    throw err;
  }
}
