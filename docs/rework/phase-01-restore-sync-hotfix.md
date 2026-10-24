# Phase 01 — Restore sync now (hotfix)

## Goal
Within one day of merging, every connected rider's recent rides are back on sf2ging.com without anyone re-authorizing Strava, and the cron workflow turns red when syncing fails. This is a stopgap; Phase 04 replaces the mechanism.

## Why
`/api/cron` returns 202 and leaves `runCronJobs()` as a dangling promise; Cloudflare cancels it, so the scheduled sync has done nothing for months (F2.1). 69 of 70 riders have stale data; Simon's last ride is from July. Their refresh tokens are still valid (F2.5), so simply running the sync fixes it.

## Prerequisites
- Phase 00 merged (CI, local DB). Can be developed in parallel and merged right after.

## Scope
- In: `app/routes/api/cron.ts`, `app/server/cron.ts`, `app/lib/constants.ts` (`CRON_SYNC_BUDGET`), `.github/workflows/cron.yml`, tests in `app/server/__test__/cron-route.test.ts`.
- Out: webhook, job table, sync algorithm, UI.

## Steps
1. **Test first.** Write `cron-route.test.ts` asserting that the POST handler *awaits* the work: mock `runCronJobs` to resolve after 50 ms with `{syncAll:{synced:2,failed:1,...}}` and assert the response body contains those counts and status 200 (not 202). Write a test that a non-2xx-worthy result (`failed > 0`) is reported in the body as `ok: false`.
2. **Await the work inline** in `app/routes/api/cron.ts`: `const result = await runCronJobs(); return Response.json({ ok: result.syncAll.failed === 0, ...summary }, { status: 200 })`. Remove the fire-and-forget. (Workers have no wall-clock limit while the client is connected; GitHub's `curl --max-time 300` is the bound.)
3. **Fit one invocation inside the 50-subrequest cap.** Keep `MAX_USERS_PER_RUN = 6` but add a `?batch=<n>` query param so a single call can be told to skip the first `n*6` users (ordered by `last_sync_at NULLS FIRST`). Set `MAX_TOTAL_DURATION_MS` to 240 s. Log the subrequest count per run (`console.log('[cron] subrequests≈', count)`).
4. **Make the reclassify/refresh step opt-in** via `?reclassify=1`, so the user-sync batches don't spend subrequests on it; the workflow calls it once at the end.
5. **Workflow:** replace the single call with a loop: `for b in 0..11: POST /api/cron?batch=$b` (12 × 6 = 72 ≥ 70 users), then one `POST /api/cron?reclassify=1`. Parse each JSON body; `exit 1` if any `ok:false` or non-200. Change the schedule to `*/30 * * * *` (GitHub will still deliver ~every 1–3 h; see F2.2 — acceptable for a hotfix). Keep `workflow_dispatch`.
6. **Strava budget check.** 72 users × ≤ 3 reads = ≤ 216 reads per workflow run. At the observed ~5 runs/day that is ≈ 1,080/day — over the 1,000/day non-upload limit if every user needs 3 calls. Mitigate: in `syncAllUsers`, skip users whose `last_sync_at` is within the last 4 hours (most will be after the first full pass), and stop the loop when the response header `X-RateLimit-Usage` reports > 85 % of either bucket (the header is already parsed in `app/lib/rate-limiter.ts` — wire it to `estimatedApiCalls`).
7. **Backfill the truncated users.** For the 8 users with `last_sync_at IS NULL` and rides > 0 (F2.3), the incremental path starts from `last_activity_at = NULL` = full sync again, which will truncate again at 5 pages. Short-term: set `last_activity_at` to each user's `MAX(rides.start_date)` in a one-off SQL (document the statement in the PR; Phillip runs it on prod). Phase 04 adds a real cursor.
8. **Run it.** Trigger `workflow_dispatch` once after deploy and watch the job output.

## Acceptance criteria
- [ ] After one manual workflow run: `SELECT count(*) FROM users WHERE last_sync_at > now() - interval '1 day'` ≥ 60.
- [ ] Simon Bernal's profile shows rides dated after 2026-07-25.
- [ ] A forced failure (e.g. temporarily wrong `CRON_SECRET` in the workflow env) makes the workflow run red.
- [ ] Strava app dashboard shows daily usage < 800 after a full day.
- [ ] No 1102 in the cron path: Cloudflare Workers dashboard → Errors for `/api/cron` is 0 over 24 h.

## Verification
```bash
pnpm test -- cron-route
# local: pnpm dev, then
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:5173/api/cron?batch=0" | jq
```
Then on prod via GitHub → Actions → "Cron — Sync All Users" → Run workflow.

## Risks & rollback
- Rate limiting: if Strava returns 429s the run stops early (step 6); nothing breaks, the next run continues. Rollback is reverting the workflow file.
- A long-running request could still hit the 10 ms CPU cap if a user's incremental sync returns hundreds of activities (classification is CPU-bound). The per-page `MAX_PAGES_PER_SYNC = 5` keeps this bounded as today; truly large backlogs are deferred to Phase 04's cursor.

## Size
~150 lines. One PR. Ship the same day.
