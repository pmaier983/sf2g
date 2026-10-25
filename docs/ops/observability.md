# Errors and the monthly report

Design: phase 08 (`docs/rework/phase-08-observability.md`). Everything here is
free and fits Workers Free.

## Where errors go

| Where it fails | Captured by | Where to look |
|---|---|---|
| Server function throws | Start function middleware (`app/start.ts`) | DevTools → Recent Errors, `app_errors` |
| Page/document request throws | Start request middleware + `app/ssr.tsx` fallback | same |
| `/api/cron`, `/api/webhook`, Cron ticks | `reportError()` | same |
| Sync job fails for a real reason | `reportJobFailures()` (≤ 2 per tick) | same, plus Sync Health |
| Browser render, loader, unhandled rejection | `trackError()` → PostHog `$exception` | PostHog → Error tracking |

- Expected failures are not recorded: redirects, `Forbidden`,
  `Not authenticated`, missing Strava scopes, Strava rate limits, revoked
  tokens, and anything thrown as `ExpectedError` (`app/lib/errors.ts`).
- Each isolate writes at most 20 rows a minute, so a hot loop can't spend the
  subrequest budget. Every error is still logged (`[error] scope: message`).
- Rows are grouped by fingerprint (scope + message with ids and numbers
  removed) and kept 90 days; the monthly job prunes older ones.

```sql
select * from get_error_groups('7 days', 50);
select occurred_at, scope, message from app_errors order by occurred_at desc limit 20;
```

## The monthly report

The Cron Trigger `0 16 1 * *` (9 am PDT on the 1st) emails a report on the
previous LA calendar month: SF2G rides, riders, distance, climbing, corridors,
riders of the month, group rides, a three-month trend, site usage, Worker
metrics and health (sync, errors), each compared with the month before and the
same month a year earlier. A sent month is never re-sent automatically.

Run or preview by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://sf2ging.com/api/cron?task=monthly-report&dry=1"
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://sf2ging.com/api/cron?task=monthly-report&month=2026-09&force=1"
```

or DevTools → Monthly Report (Preview / Send now). Every run is stored in
`monthly_reports` (subject, HTML, text, data, sent_to, send_error).

## Setup (one time)

| Secret | Needed for | How |
|---|---|---|
| `RESEND_API_KEY` | sending the email | resend.com → API Keys (free: 3,000/month). |
| `REPORT_EMAIL_TO` | the recipient | Your address. Without a verified domain, Resend only delivers to the address that owns the Resend account. |
| `REPORT_EMAIL_FROM` | optional | Default `SF2G Reports <onboarding@resend.dev>`; set after verifying sf2ging.com in Resend. |
| `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | "Site usage" | PostHog → Settings → Personal API keys, scope `query:read`. Project id `113623`. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | "Platform" | Cloudflare → API Tokens, permission Account Analytics: Read. |

```bash
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put REPORT_EMAIL_TO
```

Sections whose secrets are missing say so in the email instead of failing.
Cloudflare's own Email Sending needs Workers Paid, which is why the report
uses Resend.

## PostHog key

Before phase 08 the browser never had the PostHog key: `VITE_POSTHOG_KEY` is a
Worker secret, but Vite only inlines `VITE_*` variables at build time, so the
production bundle shipped without it and no pageviews or errors reached
PostHog. The root route now loads it from the Worker (`getPublicConfig`). No
action needed beyond keeping the `VITE_POSTHOG_KEY` secret set.
