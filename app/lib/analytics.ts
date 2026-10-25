/**
 * Analytics/logging wrapper around PostHog.
 * Client-only — must not be imported directly in server-only code paths.
 *
 * Errors are sent as PostHog `$exception` events (Error Tracking), so they
 * are grouped by stack and show up under Error tracking in PostHog. Server
 * errors are stored in `app_errors` instead (app/server/report-error.ts).
 */
import posthog from "posthog-js";
import { errorMessage } from "./errors";

let initialized = false;

export type ErrorCategory =
  | "strava_api"
  | "sync"
  | "auth"
  | "client"
  | "network";

/**
 * Initialize PostHog. Call once from __root.tsx useEffect with the key from
 * the root loader (`getPublicConfig`); `VITE_POSTHOG_KEY` is only a fallback
 * for builds that inline it.
 */
export function initAnalytics(key?: string | null) {
  if (initialized || typeof window === "undefined") return;

  // Skip analytics entirely in development — PostHog requests get blocked
  // by ad blockers / local proxy mismatches, flooding the console with errors
  // and causing hydration mismatches.
  if (import.meta.env.DEV) return;

  const token = key ?? import.meta.env.VITE_POSTHOG_KEY;
  if (!token) {
    console.warn("[analytics] PostHog key not configured; nothing is tracked");
    return;
  }

  try {
    posthog.init(token, {
      // Route through the app's own domain to bypass ad blockers.
      // The /ingest path is proxied to PostHog by the SSR handler (see ssr.tsx).
      api_host: "/ingest",
      ui_host: "https://us.i.posthog.com",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
      persistence: "localStorage",

      // Disable features that load external scripts (dead-clicks, web-vitals,
      // toolbar, surveys, exception autocapture, etc.). These inject <script>
      // tags that ad blockers catch, generating noisy console errors. Errors
      // are captured by our own handlers below via captureException.
      disable_external_dependency_loading: true,
      disable_session_recording: true,
      disable_surveys: true,
      enable_recording_console_log: false,
      advanced_disable_feature_flags: true,
      advanced_disable_decide: true,
    });
    initialized = true;
  } catch {
    // PostHog init can fail if blocked — silently degrade
  }
}

/** True once PostHog is sending (never in dev or without a key). */
export function isAnalyticsEnabled(): boolean {
  return initialized;
}

/** Identify the logged-in user (call after auth). */
export function identifyUser(userId: string, props?: Record<string, unknown>) {
  if (!initialized) return;
  posthog.identify(userId, props);
}

/** Reset identity on logout. */
export function resetUser() {
  if (!initialized) return;
  posthog.reset();
}

/** Track a custom event. */
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
) {
  if (!initialized) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // never let analytics break the page
  }
}

/** Record an error as a PostHog exception with structured metadata. */
export function trackError(
  category: ErrorCategory,
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (!initialized) return;
  const err = error instanceof Error ? error : new Error(errorMessage(error));
  try {
    posthog.captureException(err, { error_category: category, ...context });
  } catch {
    // never let analytics break the page
  }
}

/** Set up global error handlers for uncaught errors. */
export function setupGlobalErrorHandlers() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    trackError("client", event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    trackError("client", event.reason, {
      type: "unhandled_promise_rejection",
    });
  });
}
