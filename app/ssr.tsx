import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";
import { handlePostHogProxy } from "./server/posthog-proxy";

const startHandler = createStartHandler(defaultStreamHandler);

// Providing `RequestHandler` from `@tanstack/react-start/server` is required so that the output types don't import it from `@tanstack/start-server-core`
export type ServerEntry = { fetch: RequestHandler<Register> };

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
  };
}

export default createServerEntry({ fetch: startHandler });
