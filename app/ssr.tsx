import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";
import { handlePostHogProxy } from "./server/posthog-proxy";
import { runScheduledTick } from "./server/scheduled";
import { reportError } from "./server/report-error";
import type { ReportKind } from "./lib/report";

const startHandler = createStartHandler(defaultStreamHandler);

/** Cron expressions from wrangler.jsonc → the report each one emails. */
export const REPORT_CRONS: Record<string, ReportKind> = {
  "0 16 * * 1": "week",
  "0 16 1 * *": "month",
};

// Providing `RequestHandler` from `@tanstack/react-start/server` is required so that the output types don't import it from `@tanstack/start-server-core`
export type ServerEntry = {
  fetch: RequestHandler<Register>;
  /** Cloudflare Cron Trigger (wrangler.jsonc → triggers.crons) */
  scheduled?: (
    controller: { cron: string; scheduledTime: number },
    env: unknown,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) => Promise<void>;
};

export async function runScheduled(cron: string): Promise<void> {
  try {
    const reportKind = REPORT_CRONS[cron];
    if (reportKind) {
      const { runReportTick } = await import("./server/report");
      await runReportTick(reportKind);
    } else {
      await runScheduledTick(cron);
    }
  } catch (err) {
    // The tick itself crashed (not a single job): record it, never rethrow
    // into the runtime.
    await reportError("scheduled", err, { cron });
  }
}

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(request, ...rest) {
      const url = new URL(request.url);
      try {
        // Proxy PostHog analytics through the app's own domain to bypass ad blockers
        if (url.pathname.startsWith("/ingest")) {
          return await handlePostHogProxy(request);
        }
        return await entry.fetch(request, ...rest);
      } catch (err) {
        // Last line of defence: anything Start's own middleware did not see
        // (the proxy, a crash before routing). Recorded, then a plain 500
        // instead of an opaque Worker error.
        await reportError("request", err, {
          requestUrl: url.pathname,
          method: request.method,
        });
        return new Response("Internal error", { status: 500 });
      }
    },
    // Every few minutes: queue riders due for a sync, then drain the queue
    // within one invocation's budget (app/server/scheduled.ts). Mondays and
    // the 1st: the report emails (app/server/report.ts).
    async scheduled(controller, _env, ctx) {
      ctx.waitUntil(runScheduled(controller.cron));
    },
  };
}

export default createServerEntry({ fetch: startHandler });
