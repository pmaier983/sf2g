# Phase 08 — Error capture and the monthly report

## Goal
Every unexpected failure is recorded somewhere Phillip will see it, and once a
month an email summarises how the site and the community did compared with
previous months.

## Findings that motivated it (2026-10-24)
- **PostHog received nothing.** No events in 90 days. `VITE_POSTHOG_KEY` exists
  only as a Worker secret; Vite inlines `VITE_*` at build time, so the deployed
  bundle has no key and `initAnalytics()` silently returned. Client error
  tracking (`trackError`) was therefore also a no-op.
- **Server errors lived only in Workers logs** (3-day retention on Free), as
  ~30 ad-hoc `console.error` calls. Server functions that threw were not
  recorded at all.
- **Loader errors had no error component**; only render errors hit the root
  `ErrorBoundary`.
- Cloudflare Email Sending is not available on Workers Free.

## What shipped
- Migration 044: `app_errors`, `monthly_reports`, `get_monthly_report(month)`,
  `get_error_groups(since, n)`, `prune_app_errors(keep)`; service-role only.
- `app/start.ts`: global request + function middleware → `reportError()`
  (`app/server/report-error.ts`): logs, stores one row, never throws,
  ignores expected errors, throttled to 20 rows/min/isolate.
- Cron ticks, `/api/cron`, `/api/webhook`, the PostHog proxy and job failures
  (≤ 2 per tick, excluding rate limits and revoked tokens) report too.
- Client: PostHog key from the root loader (`getPublicConfig`); `trackError`
  sends `$exception` via `captureException`; router `defaultErrorComponent`
  with retry; error page shows the message.
- Monthly report: `app/lib/monthly-report.ts` (pure renderer),
  `app/server/monthly-report.ts` (collect, store, send, idempotent),
  `app/server/email.ts` (Resend). Cron `0 16 1 * *`; `/api/cron?task=monthly-report`;
  DevTools Preview / Send now.

## Weekly report (added after phase 08)
The monthly report became a `kind: "week" | "month"` report: migration 047
renames `monthly_reports` → `reports` keyed by `(kind, period_start)` and
replaces `get_monthly_report` with `get_report(kind, start)`; a second Cron
Trigger `0 16 * * 1` emails the previous Monday–Sunday week.
`app/lib/report.ts`, `app/server/report.ts`, `/api/cron?task=weekly-report`.

## Deploy order
1. `supabase db push --linked` (044) — before the app.
2. `wrangler secret put RESEND_API_KEY` and `REPORT_EMAIL_TO` (optional:
   PostHog and Cloudflare analytics secrets, see docs/ops/observability.md).
3. `pnpm deploy` (adds the second Cron Trigger).
4. Check: `curl … /api/cron?task=monthly-report&dry=1`, then DevTools → Preview.

## Out of scope
Alerting on spikes (a daily digest could reuse `get_error_groups`), source
maps for PostHog, uptime checks.
