# Operations

Runbooks for keeping sf2ging.com healthy. Production is one Cloudflare
Worker (Free plan) and one Supabase project (`dgoqjrfjrzewplwayhhz`, Free
plan). Everything here is done by Phillip; agents never write to production.

- [observability.md](observability.md) — where errors go, the monthly report email
- [sync.md](sync.md) — how rides arrive, the Strava webhook subscription,
  inspecting and retrying sync jobs
- [Deploying](#deploying)
- [Database migrations](#database-migrations)
- [Rotating secrets](#rotating-secrets)
- [Reading logs](#reading-logs)
- [When Strava rate-limits](#when-strava-rate-limits)
- [Protecting /api/cron](#protecting-apicron)

## Deploying

```bash
pnpm typecheck && pnpm test && pnpm test:db && pnpm e2e
pnpm deploy                      # NODE_ENV=production vite build && wrangler deploy
```

Check a PR's description for a deploy order. Migrations that remove things
(e.g. 042) go **after** the app version that stops using them; migrations
that add things (e.g. 041) go **before** the app that needs them.

## Database migrations

Migrations live in `supabase/migrations/NNN_*.sql`, are append-only, and
reach production only through:

```bash
supabase link --project-ref dgoqjrfjrzewplwayhhz   # once
supabase db push --linked --dry-run                 # review what will run
supabase db push --linked
```

Before pushing, run them locally: `pnpm db:reset && pnpm test:db`.
After pushing, check the advisors (Supabase dashboard → Advisors) — the
target is no WARN-level findings — and `pnpm db:types:prod` to confirm the
generated types match.

Rollback: write a new migration that undoes the change (never edit an
applied one). Materialized views and SQL functions can be recreated from
their original migration's SQL.

## Rotating secrets

All are Worker secrets: `pnpm exec wrangler secret put NAME` (this publishes
a new Worker version with the secret; no separate deploy needed).

| Secret | Effect of rotating |
|---|---|
| `SESSION_SECRET` | Everyone is signed out (old cookies fail the HMAC). |
| `CRON_SECRET` | Update anything that calls `/api/cron` (only manual curl today). |
| `STRAVA_CLIENT_SECRET` | Regenerate at strava.com/settings/api, then put. Riders stay connected. |
| `SUPABASE_SERVICE_ROLE_KEY` | Roll in Supabase → Settings → API (JWT secret), then put the new key. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Only checked when (re)registering the webhook — see sync.md. |
| `RESEND_API_KEY` | Monthly report email; rotate at resend.com. See observability.md. |

## Reading logs

```bash
pnpm exec wrangler tail --format pretty        # live
```

or Cloudflare dashboard → Workers → sf2g → Logs. Useful lines:

- `[perf] <label> subreq=N ms=N` — every server function and each Cron
  tick. `subreq` near 50 or a 1102 error means a request is doing too much
  work: find the label and move the work into SQL or the queue.
- `[scheduled] claimed=… done=… requeued=… failed=… stop=…` — one per
  Cron tick (every 5 min). `stop=rate_limited` is expected occasionally.
- `[webhook]` — events received/ignored.
- `[error] <scope>: <message>` — an unexpected failure, also stored in
  `app_errors` (DevTools → Recent Errors). See observability.md.
- `[monthly-report] YYYY-MM sent|stored|already_sent|send_failed` — the
  monthly email (1st of the month).

## When Strava rate-limits

Limits: 100 reads / 15 min and 1,000 / day (overall 200 / 2,000).

- The drain stops at the first 429 or when usage is near the limit, and
  re-queues the job 15 minutes out without counting an attempt. Nothing to
  do; the queue catches up.
- A big catch-up (e.g. after migration 041 queued every rider) takes a few
  hours by design.
- If a single rider keeps failing: DevTools → Sync Health, or
  `select * from sync_jobs where status='failed'` (sync.md has the retry SQL).
- Riders with `needs_reauth` see a "Reconnect Strava" banner; nothing to do
  unless they ask.

## Protecting /api/cron

`POST /api/cron?task=drain|maintenance|groups` requires
`Authorization: Bearer $CRON_SECRET`; the scheduled work itself runs from
the Cron Trigger, not this endpoint. To stop anyone from hammering it
(each call is a Worker invocation), add a free Cloudflare WAF rule:

Security → WAF → Rate limiting rules → *URI Path equals `/api/cron`* →
10 requests / 10 seconds per IP → Block.

DevTools admin actions call the same code through server functions gated by
`assertAdmin()` (`ADMIN_USER_IDS`). A local dev server pointed at a
non-local database is refused outright.

> `.env.local` sets `NODE_ENV=development` for the local dev server. Vite
> reads it during a build too, so a plain `pnpm build` on a laptop produces a
> development bundle (slow React, analytics disabled). `pnpm deploy` forces
> `NODE_ENV=production`; always deploy with it.
