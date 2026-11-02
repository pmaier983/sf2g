/**
 * DevTools (admin only): recent server errors and the weekly/monthly report.
 * Every function starts with `assertAdmin()` (app/lib/admin.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceClient } from "../lib/supabase";
import { assertAdmin } from "../lib/admin";
import { isReportKind, type ReportKind } from "../lib/report";
import type { ReportRun } from "./report";

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

export interface ReportRequest {
  kind: ReportKind;
  /** YYYY-MM-DD (week) or YYYY-MM (month); omitted = the previous LA period. */
  period?: string;
  /** true = email it (and mark the period sent); false = render and store. */
  send: boolean;
}

function validateRequest(input: unknown): ReportRequest {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!isReportKind(o.kind)) throw new Error(`kind must be week or month`);
  const period =
    typeof o.period === "string" && o.period ? o.period : undefined;
  return { kind: o.kind, period, send: o.send === true };
}

/**
 * Render a report now. With `send: true` it is emailed to REPORT_EMAIL_TO
 * even if that period already went out (a manual re-send). The period is
 * validated by runReport.
 */
export const runReportNow = createServerFn({ method: "POST" })
  .inputValidator(validateRequest)
  .handler(async ({ data }): Promise<ReportRun> => {
    await assertAdmin();
    const { runReport, defaultReportDeps } = await import("./report");
    return runReport(
      {
        kind: data.kind,
        period: data.period,
        send: data.send,
        force: data.send,
      },
      defaultReportDeps(),
    );
  });
