import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";
import { handlePostHogProxy } from "./server/posthog-proxy";
import { runScheduledTick } from "./server/scheduled";

const startHandler = createStartHandler(defaultStreamHandler);

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

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(request, ...rest) {
      // Proxy PostHog analytics through the app's own domain to bypass ad blockers
      const url = new URL(request.url);
      if (url.pathname.startsWith("/ingest")) {
        return handlePostHogProxy(request);
      }
      return await entry.fetch(request, ...rest);
    },
    // Every few minutes: queue riders due for a sync, then drain the queue
    // within one invocation's budget (app/server/scheduled.ts).
    async scheduled(controller, _env, ctx) {
      ctx.waitUntil(
        runScheduledTick(controller.cron).catch((err) => {
          console.error("[scheduled] tick failed", err);
        }),
      );
    },
  };
}

export default createServerEntry({ fetch: startHandler });
