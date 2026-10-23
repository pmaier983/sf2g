# Phase 04 — Reliable sync (webhook-first, job table, Cron Trigger)

## Goal
A ride uploaded to Strava by any connected rider appears on the site within ~5 minutes via webhook, and within a few hours via a scheduled sweep if the webhook missed it. Interrupted syncs resume where they stopped. Every failure is recorded per user and visible in DevTools; riders see a "Reconnect Strava" banner only when their token is truly dead. The GitHub Actions cron is deleted.

## Why
Phase 01 made the old mechanism work but it still depends on GitHub's best-effort schedule (F2.2), truncates big imports (F2.3), and processes webhooks inline before the 200 (F2.4). ADR-2 chose a job table drained by a Cloudflare Cron Trigger, within the free plan.

## Prerequisites
- Phases 00, 01, 02 merged. 03 is independent (different files) and can run in parallel.
- Phillip has run the push-subscription check (F2.4) and shared the result:
  `curl -G https://www.strava.com/api/v3/push_subscriptions -d client_id=… -d client_secret=…`

## Scope
Four PRs.

### 04a — Spike + job table + webhook ack-and-enqueue
- In: `supabase/migrations/044_sync_jobs.sql`, `app/server/sync-jobs.ts` (enqueue/claim/complete helpers), `app/routes/api/webhook.ts`, `app/server/webhook.ts`, tests with MSW. Plus `docs/rework/spikes/04a-cpu.md` with measurements.
- Out: the drain loop, UI.

### 04b — Cron Trigger drain loop
- In: `app/worker.ts` (new Worker entry exporting `fetch` from TanStack Start and `scheduled`), `wrangler.jsonc` (`main`, `triggers.crons = ["*/5 * * * *"]`), `app/server/sync-drain.ts`, `app/server/sync.ts` refactored into resumable page-sized steps, tests.
- Out: UI.

### 04c — Backfill, sync health, reconnect banner
- In: `045_sync_state.sql` (or columns on `users`), `app/server/users.ts`, `DevToolsPanel.tsx` (health table), `SyncStatus.tsx` / `NavBar.tsx` (banner for `needs_reauth`), a one-off enqueue of `backfill` jobs for the 8 truncated users.

### 04d — Retire GitHub Actions cron + group-ride recompute on new rides
- In: delete `.github/workflows/cron.yml`, remove `?batch` plumbing from Phase 01, make `computeAndStoreGroupRides` incremental (only dates touched by the tick's upserts), schedule MV refreshes as a job kind.

## Steps

### 04a
1. **Spike (time-boxed to half a day):** in `wrangler dev`, process a synthetic page of 200 activities through `activityToRideInsert` + classifier and log `performance.now()`. Record ms per activity. Decision rule: if 50 activities classify in ≤ 8 ms, proceed with Workers; if not, record it and switch 04b's drain to a Supabase Edge Function (`supabase/functions/sync-drain`) invoked by `pg_cron` every 5 min — same job table, same tests. Also verify that `@cloudflare/vite-plugin` lets `wrangler.jsonc#main` point at a custom entry that re-exports the Start handler; if not, fall back to a second Worker (`workers/sync/`) built with plain wrangler sharing code via `app/server/sync-core/`.
2. **Migration `044_sync_jobs.sql`:**
   ```sql
   CREATE TABLE sync_jobs (
     id bigserial PRIMARY KEY,
     user_id uuid REFERENCES users(id) ON DELETE CASCADE,
     kind text NOT NULL CHECK (kind IN ('webhook_activity','incremental','backfill','refresh_views','recompute_groups')),
     payload jsonb NOT NULL DEFAULT '{}',   -- e.g. {activity_id, aspect}
     cursor jsonb NOT NULL DEFAULT '{}',    -- e.g. {page, before, after}
     run_after timestamptz NOT NULL DEFAULT now(),
     attempts int NOT NULL DEFAULT 0,
     last_error text,
     status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
     created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
   );
   CREATE INDEX ON sync_jobs(status, run_after);
   CREATE UNIQUE INDEX ON sync_jobs(user_id, kind) WHERE status IN ('queued','running') AND kind IN ('incremental','backfill');
   CREATE FUNCTION claim_sync_jobs(n int) RETURNS SETOF sync_jobs ... FOR UPDATE SKIP LOCKED ...  -- service role only
   ```
   RLS on; no anon grants.
3. **Tests first** (`app/server/__test__/db/webhook.test.ts`, MSW + local DB): a valid `activity.create` POST inserts exactly one `webhook_activity` job and returns 200 within one Supabase request; duplicate events for the same `object_id` don't create a second queued job; unknown `owner_id` → no job, 200; `athlete.update` with `authorized:false` → marks `deauthorized_at` directly (cheap) and returns 200; GET handshake unchanged.
4. **Rewrite the webhook route** to do only that. Keep the always-200 behavior.
5. **Register the subscription** (Phillip, one-time, documented in `docs/ops/strava-webhook.md`): `POST https://www.strava.com/api/v3/push_subscriptions` with `callback_url=https://sf2ging.com/api/webhook` and the verify token. Store the returned `subscription_id` in `STRAVA_WEBHOOK_SUBSCRIPTION_ID` and validate it in the POST handler (closes the TODO).

### 04b
6. **Resumable sync core.** Refactor `performSync` into `syncStep(job)`: fetch **one** Strava page (`per_page` 100, `after`/`before` from cursor), transform + classify, upsert, update `cursor`, return `{ done: boolean }`. No loops inside a step. Token refresh via `ensureValidToken` as today.
7. **Drain loop** `drainSyncJobs({ maxSubrequests: 40, maxMs: 7 })`: claim up to N jobs (N = 6 by default), run `syncStep` for each, stop early when either budget is near. Budget accounting: count Supabase + Strava calls; read `X-RateLimit-Usage` and stop the tick at > 85 % of the 15-min or daily bucket; re-enqueue unfinished jobs with `run_after = now()` (or `+ 15 min` on 429). Failure: `attempts++`, `run_after = now() + 2^attempts min`, `failed` after 5, `last_error` set; `invalid_grant` on token refresh → `users.needs_reauth = true` and job `failed` (ADR-3).
8. **Worker entry** `app/worker.ts`: `export default { fetch: startHandler.fetch, scheduled: (event, env, ctx) => ctx.waitUntil(drainSyncJobs()) }`. `wrangler.jsonc`: `"triggers": { "crons": ["*/5 * * * *"] }`. Every tick also enqueues the daily plan if due: one `incremental` job per active user spread across the day (`run_after` staggered) so Strava reads ≈ 70 × 2 × 2 sweeps = 280/day + webhooks.
9. **Tests:** drain respects budgets (fake clock + counters), resumes a 3-page backfill across 3 ticks, backs off on failure, flags `needs_reauth` on `invalid_grant`, never processes the same job twice concurrently (two drains in parallel against the local DB).

### 04c
10. **Sync state:** add `users.needs_reauth boolean default false`, `users.last_sync_success_at`, keep `last_sync_error`. A view `sync_health` (service role) joins users + latest job per kind.
11. **DevTools panel:** table of riders with last success, queued/failed jobs, last error, buttons "Enqueue incremental" / "Enqueue backfill" (service role server fns, admin-gated as the existing DevTools actions are).
12. **Banner:** for the logged-in user only, if `needs_reauth` → "Reconnect Strava" linking to `/auth/login?force=true`. Nothing else prompts.
13. **Backfill the 8 truncated users:** enqueue `backfill` jobs with `cursor = { before: <min(start_date) epoch>, page: 1 }` so they import *older* rides than they already have, resuming across ticks. Also enqueue `incremental` for everyone once.

### 04d
14. Delete `.github/workflows/cron.yml` and Phase 01's `?batch` plumbing; `/api/cron` stays as an admin-only "enqueue everything now" endpoint.
15. **Incremental group rides:** `computeAndStoreGroupRides({ dates })` recomputes only `ride_date`s touched by the tick's upserts; `refresh_views` job runs MV refreshes at most every 30 min when anything changed. Phase 03d's `rider_edges` refresh hooks in here.

## Acceptance criteria
- [ ] Webhook POST p95 < 300 ms and makes exactly 1 Supabase request (edge logs).
- [ ] Upload a ride on Strava (Phillip): it is on the leaderboard within 10 minutes with no page interaction.
- [ ] `SELECT count(*) FROM users WHERE last_sync_success_at > now() - interval '1 day'` ≥ 65 after 24 h; the remaining ones have `needs_reauth` or `deauthorized_at` set and a `last_error`.
- [ ] The 8 truncated users have rides older than their previous `MIN(start_date)` (backfill ran) and `last_sync_at` set.
- [ ] Strava API dashboard daily usage < 500 on a normal day.
- [ ] Cloudflare: 0 errors on the scheduled handler over 7 days; `[perf]` log per tick shows `subreq ≤ 45` and `cpu ≈ < 8 ms` (log `Date.now()` deltas around CPU-only sections as a proxy).
- [ ] `.github/workflows/cron.yml` no longer exists; GitHub Actions page shows only CI.

## Verification
```bash
pnpm test:db -- webhook sync-drain
wrangler dev --test-scheduled      # then: curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```
Prod: Cloudflare dashboard → Workers → sf2g → Triggers (cron listed) and Logs (tail during a tick).

## Risks & rollback
- Cron Trigger CPU budget turns out too tight for classification → the 04a spike catches it before any code is written; the Edge Function fallback keeps the same schema and tests.
- Strava daily limit: budgets are enforced from the response headers, not from constants; worst case the sweep slows down.
- Rollback for any sub-phase: revert the PR; the job table is inert without a drain.

## Size
04a ~400 lines, 04b ~600, 04c ~350, 04d ~250. Four PRs.
