/**
 * /api/cron — Placeholder route for TanStack's file-based router.
 *
 * The actual cron request handling is done at the SSR entry level (ssr.tsx)
 * so we can access Cloudflare's ExecutionContext for fire-and-forget
 * background execution via waitUntil().
 *
 * See: app/server/cron-handler.ts for the implementation.
 *
 * This file exists so TanStack's router doesn't generate a 404 for /api/cron
 * if the route tree is used for other purposes (e.g., preloading).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron")({});
