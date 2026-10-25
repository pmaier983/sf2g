/**
 * DevTools (admin only): recent server errors and the monthly report.
 * Every function starts with `assertAdmin()` (app/lib/admin.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceClient } from "../lib/supabase";
import { assertAdmin } from "../lib/admin";
import type { MonthlyReportRun } from "./monthly-report";

export interface ErrorGroup {
  fingerprint: string;
  scope: string;
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sampleStack: string | null;
  sampleContext: string | null;
  sampleUrl: string | null;
}

export interface RecentErrors {
  /** Window the groups cover, e.g. "7 days". */
  since: string;
  groups: ErrorGroup[];
}

/** Server errors from the last week, grouped by fingerprint (one SQL call). */
export const fetchRecentErrors = createServerFn({ method: "GET" }).handler(
  async (): Promise<RecentErrors> => {
    await assertAdmin();
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("get_error_groups", {
      p_since: "7 days",
      p_limit: 50,
    });
    if (error) throw new Error(`get_error_groups: ${error.message}`);
    return {
      since: "7 days",
      groups: (data ?? []).map((g) => ({
        fingerprint: g.fingerprint,
        scope: g.scope,
        message: g.message,
        count: Number(g.count),
        firstSeen: g.first_seen,
        lastSeen: g.last_seen,
        sampleStack: g.sample_stack,
        sampleContext: g.sample_context
          ? JSON.stringify(g.sample_context)
          : null,
        sampleUrl: g.sample_url,
      })),
    };
  },
);

export interface MonthlyReportRequest {
  /** YYYY-MM; omitted = previous LA month. */
  month?: string;
  /** true = email it (and mark the month sent); false = render and store. */
  send: boolean;
}

function validateRequest(input: unknown): MonthlyReportRequest {
  const o = (input ?? {}) as Record<string, unknown>;
  const month = typeof o.month === "string" && o.month ? o.month : undefined;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`month must be YYYY-MM, got ${month}`);
  }
  return { month, send: o.send === true };
}

/**
 * Render the monthly report now. With `send: true` it is emailed to
 * REPORT_EMAIL_TO even if that month already went out (a manual re-send).
 */
export const runMonthlyReportNow = createServerFn({ method: "POST" })
  .inputValidator(validateRequest)
  .handler(async ({ data }): Promise<MonthlyReportRun> => {
    await assertAdmin();
    const { runMonthlyReport, defaultMonthlyReportDeps } =
      await import("./monthly-report");
    return runMonthlyReport(
      { month: data.month, send: data.send, force: data.send },
      defaultMonthlyReportDeps(),
    );
  });
