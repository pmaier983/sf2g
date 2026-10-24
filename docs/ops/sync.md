# Ride sync — operations

How rides get from Strava into SF2G, and what to check when someone's rides
are missing. Design: [phase 04](../rework/phase-04-reliable-sync.md).

## How it works

```
Strava webhook ──► /api/webhook ──► enqueue_webhook_event()  (one SQL call, then 200)
                                         │
OAuth callback / Sync Now ──► one page inline, rest ─┐
                                         ▼           ▼
                                   sync_jobs (queue, migration 041)
                                         ▲
Cloudflare Cron Trigger (*/5) ──► runScheduledTick()
   1. enqueue_due_syncs('12 hours')   — catch-up for anyone a webhook missed
   2. drainSyncJobs()                 — ≤ 5 jobs, ≤ 44 subrequests, one step each
```

- Job kinds: `webhook_activity`, `incremental`, `backfill` (pages backwards
  with a `{before}` cursor), `deauthorize`, `refresh_views`,
  `recompute_groups`. Rides changing queues one `refresh_views`, which
  queues one `recompute_groups`.
- Failures back off 1, 2, 4, 8, 16 minutes; a job fails for good after 5
  attempts. A Strava rate limit re-queues the job 15 minutes out without
  counting an attempt.
- A rejected refresh token (400/401) sets `users.needs_reauth`. The rider sees
  a "Reconnect Strava" banner; reconnecting clears it.
- Everything fits Workers Free (50 subrequests, 10 ms CPU per invocation);
  each tick logs `[perf] scheduled:… subreq=N ms=N` and a `[scheduled]` summary.

## Where to look

- **DevTools → Sync Health** (admins): every rider, last successful sync,
  open/failed jobs, needs-reauth. **Run Queue Tick** runs one tick now.
- SQL (Supabase dashboard):

  ```sql
  select * from sync_health order by last_sync_success_at nulls first;
  select kind, status, count(*) from sync_jobs group by 1, 2;
  select * from sync_jobs where status = 'failed' order by updated_at desc limit 20;
  ```

- Retry a failed job: `update sync_jobs set status='queued', attempts=0, run_after=now() where id = …;`
- Re-import one rider's whole history:
  `select enqueue_sync_job('backfill', '<user uuid>', '{}', jsonb_build_object('before', extract(epoch from now())::bigint));`
- Run a tick by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://sf2ging.com/api/cron?task=drain"`
  (`task=maintenance` refreshes views, `task=groups` recomputes group rides).

## Strava webhook subscription

There is one push subscription per Strava app. Check it:

```bash
curl -G https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=$STRAVA_CLIENT_ID -d client_secret=$STRAVA_CLIENT_SECRET
```

An empty list `[]` means no events are delivered (rides then arrive only
through the 12-hour sweep). Register it:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
  -F callback_url=https://sf2ging.com/api/webhook \
  -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
```

Strava calls `GET /api/webhook` to verify the token, then returns `{"id": N}`.
Set `STRAVA_WEBHOOK_SUBSCRIPTION_ID=N` as a Worker secret so events for any
other subscription are ignored (optional, recommended).

## Deploying phase 04

1. Apply migration `041_sync_jobs.sql` (it also queues one catch-up job per
   connected rider and a backfill for riders whose first import never
   finished).
2. Deploy the Worker. `wrangler.jsonc` now sets `main: ./app/ssr.tsx` (the
   real entry — it was previously bypassed, which also disabled the PostHog
   `/ingest` proxy) and `triggers.crons: ["*/5 * * * *"]`.
3. Check the Cron Trigger in the Cloudflare dashboard (Workers → sf2g →
   Settings → Triggers) and watch the logs for `[scheduled]` lines.
4. Later, after phase 06b is deployed, apply 042 (drops the unused
   materialized views — see its header for the deploy order).
5. The GitHub Actions cron workflow is gone; remove its `CRON_SECRET` repo
   secret only if nothing else uses it (`/api/cron` still does).
