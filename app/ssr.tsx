import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";
import { handlePostHogProxy } from "./server/posthog-proxy";
import { handleCronRequest } from "./server/cron-handler";

const startHandler = createStartHandler(defaultStreamHandler);

// Providing `RequestHandler` from `@tanstack/react-start/server` is required so that the output types don't import it from `@tanstack/start-server-core`
export type ServerEntry = { fetch: RequestHandler<Register> };

/**
 * Cloudflare Workers ExecutionContext.
 * The `ctx` parameter is passed as the 3rd argument to the `fetch` handler
 * by the Cloudflare runtime. `waitUntil` keeps the worker alive after the
 * response is sent, which we use for fire-and-forget cron execution.
 */
interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export function createServerEntry(entry: ServerEntry): ServerEntry {
  return {
    async fetch(request, ...rest) {
      const url = new URL(request.url);

      // Proxy PostHog analytics through the app's own domain to bypass ad blockers
      if (url.pathname.startsWith("/ingest")) {
        return handlePostHogProxy(request);
      }

      // Handle /api/cron at the entry level so we can access Cloudflare's
      // ExecutionContext for fire-and-forget background execution.
      // This responds with 202 immediately and runs cron jobs via waitUntil().
      if (url.pathname === "/api/cron" && request.method === "POST") {
        // Cloudflare Workers passes (request, env, ctx) but TanStack's type
        // signature only declares (request, opts?). Cast through unknown[] to
        // access the ExecutionContext that Cloudflare injects at runtime.
        const args = rest as unknown[];
        const ctx = args[1] as CloudflareExecutionContext | undefined;
        return handleCronRequest(request, ctx);
      }

      return await entry.fetch(request, ...rest);
    },
  };
}

export default createServerEntry({ fetch: startHandler });
