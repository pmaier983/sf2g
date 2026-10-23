# SF2G Rework — Research & Planning Brief

**For:** a senior research/planning agent (Claude Fable 5.1)
**Produces:** a set of phase plans that an implementation agent (Claude Opus 5.5) can execute one at a time
**Owner:** Phillip Maier (pmaier983) · Repo: `github.com/pmaier983/sf2g` · Live: https://sf2ging.com
**Written:** 2026-10-22, from a hands-on audit of the running app and codebase

---

## 1. Your job

You are not implementing anything. You are:

1. **Researching** this codebase, its production behavior, and the platform limits it runs on, deeply enough to explain *root causes* of the four problems below — with evidence, not guesses.
2. **Deciding** the target architecture (keep / change / replace each layer), and writing down each decision with its trade-off.
3. **Writing a phased implementation plan** as separate files `docs/rework/phase-NN-<slug>.md`, each one self-contained and small enough that an Opus-class agent can implement it in one session, open a PR, and stop.

Phillip has explicitly said a full rework is acceptable if that is what it takes to get a solid foundation. He has also said what to **preserve**: the site's structure, its feature set, and the tables' functionality and visuals. "Rework" means foundation and plumbing, not a redesign.

---

## 2. The problems, in Phillip's priority order

### P1 — Constant Cloudflare Error 1102 ("Worker exceeded resource limits")
Users hit 1102 regularly, "whenever we do stuff."

**What the audit found (verified in code):**
- Server functions pull **entire tables into the Worker and aggregate in JavaScript.** `app/server/leaderboard.ts` (1,179 lines) pages through `rides` 1,000 rows at a time in `while (hasMore)` loops (around lines 273, 698, 855, 898), then builds per-user aggregates, medians, etc. in JS. Same pattern in `ppr_dawn_rides`, `monthly_ride_stats`.
- Per-request **polyline decoding** for the PPR filter (`decodePolyline`, `PPR_INTERCEPTS` loops in `leaderboard.ts`).
- `app/server/alltime.ts` sliding-window computation was already patched three times for CPU timeouts.
- **8 of the repo's 73 commits** are point-fixes for 1102 / CPU / timeouts (`git log --oneline | grep -iE "1102|timeout|cpu"`). Each one shaved one hot path; the pattern was never changed.
- The code comments reference the **Cloudflare free plan** (subrequest limits in `app/lib/constants.ts` `CRON_SYNC_BUDGET`). The free plan gives ~10 ms CPU per request; Workers Paid gives far more. **Verify which plan the account is on** — this may be the single biggest lever.
- Materialized views already exist (`leaderboard_view`, `company_leaderboard_view`, `ppr_dawn_rides`, `ride_co_occurrences`, `route_speed_leaderboard`), but the date-filtered and option-filtered paths bypass them and fall back to the fetch-everything path.
- The **Strava webhook handler awaits the full pipeline inline** (`app/routes/api/webhook.ts` → `processWebhookEvent`: token refresh → Strava fetch → classify → upsert) before returning 200. Heavy work in a request handler is both a 1102 source and a P2 cause.

**Research you must do:**
- Get real numbers: row counts for `users`, `rides`; payload sizes; which endpoints 1102 most. Sources: Cloudflare Workers analytics / `wrangler tail`, Supabase logs (`get_logs`), PostHog if exceptions are captured.
- Inventory every server function and classify it: *(a)* cheap read of a precomputed view, *(b)* aggregation that belongs in Postgres (SQL/RPC/materialized view), *(c)* background work that belongs in a queue/cron, not a request.
- Decide the target: aggregation in Postgres (RPCs returning exactly what the UI renders, server-side pagination/sorting), precomputation refreshed on write, background jobs via **Cloudflare Queues / Cron Triggers / `ctx.waitUntil`** (or Supabase Edge Functions / pg_cron) — evaluate and pick.
- Be explicit about whether Workers Paid ($5/mo) is part of the plan; it is not a substitute for fixing the architecture, but it may be a day-one stopgap.

**Done means:** no request path does unbounded work proportional to total rides; p95 CPU per request is measured and well under the plan limit; 1102 rate ≈ 0.

### P2 — Rides aren't being picked up automatically
Phillip rides with people (e.g., "Simon") who have logged into the site, yet their rides — and therefore the group rides — never appear.

**What the audit found:**
- **Cron sync is throttled to near-uselessness.** `.github/workflows/cron.yml` is scheduled hourly, but GitHub Actions delivered only ~5 runs in the last 24 h (07:05, 13:26, 18:17, 22:05, 01:11 UTC on Oct 22–23). Each run syncs at most `MAX_USERS_PER_RUN = 6` users ordered by `last_sync_at`. So the real capacity is roughly **30 user-syncs/day**, not the 144 the comments assume.
- The workflow reports **success whenever `/api/cron` returns 2xx**, even if individual users failed (expired/revoked tokens, rate limits, timeouts). Silent failures are invisible.
- **Webhook may not be doing its job.** The handler exists, but the code carries a `TODO` about subscription IDs "once the subscription is created" — **verify a Strava push subscription actually exists** for the production callback URL (`GET https://www.strava.com/api/v3/push_subscriptions`). If it exists, its inline processing (above) can 1102 and drop events.
- **Token health is unknown.** There is migration `028_sync_failure_tracking.sql` — check what it records and what it shows for users like Simon. The group-ride page currently shows "<user> needs to re-login to Strava to share ride data" for at least one user, so expired/insufficient-scope tokens are real.
- Group rides are computed from `ride_co_occurrences` (a materialized view) plus clustering in `app/server/group-rides.ts` (974 lines). Commit `3606e06` "skip polyline overlap to avoid Cloudflare CPU limit" changed detection logic under CPU pressure — **check whether that weakened detection.**

**Research you must do:**
- For two or three concrete riders Phillip names (start with Simon), trace end to end: user row → token state/scopes → `last_sync_at` → failure records → rides present in Strava but missing in DB → why.
- Determine the target sync design: webhook-first (ack immediately, enqueue, process async with retries), a reliable scheduler (Cloudflare Cron Triggers instead of GitHub Actions), a backfill/repair job, and **visible sync health** (per-user last success, last error, needs-reauth) surfaced in the DevTools panel and to the rider ("reconnect Strava").
- Respect Strava rate limits (read the current Strava API limits; don't trust constants in code).

**Done means:** a new ride by any connected rider appears within minutes (webhook) or at worst within a few hours (scheduled sweep); every failure is recorded and visible; group rides including that ride appear without manual action.

### P3 — The tables are painful and buggy
"It constantly breaks. It often doesn't show you what it's supposed to. It is just miserable." Phillip likes the tables' **functionality and visuals** — keep them.

**What the audit found:**
- Table surface area: `LeaderboardTable`, `LeaderboardColumns` (710 lines), `AllTimeTable`, `RidesLeaderboardTable`, `GroupRidesTable`, `ProfileRidesTable`, `RouteSpeedTable`, `RideSubTable`, `FilterChips` (484), `useColumnResize`, and `app/routes/leaderboard.tsx` (1,046 lines). TanStack Table + TanStack Virtual.
- Filter/sort/view state lives partly in URL search params (`?view=groups`) and partly in component state. One view (Riders) is the default, with tabs for All Time / Rides / Groups.
- Filters are combined client-side and server-side across different code paths (materialized view vs. date-range RPC vs. full fetch), which is a likely source of "doesn't show what it's supposed to": the same filter can produce different numbers depending on which path ran.
- Observed inconsistency: on a profile, the header shows **573 SF2G rides / 21,642 mi** while the "SF2G Stats" card on the same page shows **833 / 22,475 mi**. Probably a definition difference (weekend exclusion? "Other"?), but it is unexplained to the user.
- Duplicate controls render for mobile and desktop simultaneously (e.g., two "Groups" buttons); the first in DOM order was not clickable in testing.

**Research you must do:**
- Collect the actual bug list. Ask Phillip for concrete repros; also mine `git log` for table-fix commits and reproduce in the browser.
- Define **one canonical query model**: a typed, validated filter/sort/pagination state (URL is the source of truth), one server function per table that accepts it, and SQL that answers it. No path where client and server compute the same number differently.
- Decide component structure: a shared table shell (virtualization, column resize, sticky headers, sort UI, empty/loading/error states) with per-table column definitions.

**Done means:** every table is driven by the same state model; every filter combination returns the same numbers whichever path computes them; the known bug list is fixed and covered by tests.

### P4 — No tests Phillip can trust
There **are** 11 test files / 440 passing Vitest tests, but they only cover pure logic in `app/lib/__test__` and `app/server/__test__` (route classifier, leaderboard filter helpers, etc.). There are **zero** component tests, zero tests against a real database, and zero end-to-end tests. Nothing would catch "the table shows the wrong thing."

**Research you must do / decide:**
- A test pyramid that fits this stack:
  - **SQL/RPC tests** against a local Supabase (`supabase start`) seeded with a deterministic fixture dataset (a few riders, known rides across routes/dates/weekends/PPR). Assert exact leaderboard numbers.
  - **Server-function tests** for sync/webhook with Strava mocked (MSW or similar).
  - **Component tests** for the table shell and each table (Vitest + Testing Library, jsdom/happy-dom).
  - **E2E** with Playwright against `pnpm dev` + local Supabase: load leaderboard, apply each filter, open profile, open group ride.
- CI: a GitHub Actions workflow running typecheck + unit + DB + e2e on every PR (currently the only workflow is the cron).
- Make "write the failing test first" a rule in every phase plan.

**Done means:** a change to a table or a query fails CI if it changes the numbers a user sees.

---

## 3. Other findings to fold in (lower priority, but don't drop)

From the Supabase advisors and the browser audit on 2026-10-22:

- **Security — high:** `batch_update_ride_classifications(jsonb)` and `refresh_leaderboard`, `refresh_company_leaderboard`, `refresh_ppr_dawn_rides`, `refresh_ride_co_occurrences` are `SECURITY DEFINER` and **executable by `anon`** via `/rest/v1/rpc/...`. Anyone holding the public anon key could rewrite ride classifications or hammer view refreshes. App code calls these through the service-role client, so revoking `EXECUTE` from `anon, authenticated` should be safe — verify, then make it **Phase 0**.
- Security — medium: 10 functions with mutable `search_path`; 5 materialized views readable by `anon` (decide if intended). `/api/cron` has a `TODO(security)` for rate limiting; webhook has a `TODO` for `subscription_id` validation.
- Perf advisor: unindexed FK `ride_overrides.user_id`; several unused indexes.
- **Hydration bug:** `/should-i-sf2g` (and `/2sf2g`) throws a React hydration mismatch in the evening Pacific time. The server (UTC) renders day pills one day ahead of the client. Any date logic must use an explicit `America/Los_Angeles` zone on both sides. Audit all date code for the same bug (leaderboard "Today/This Week" filters, PPR @ 6am, streaks, "favorite day").
- `/routes` maps render tiles watermarked **"API KEY REQUIRED"** — the tile provider needs a key (or switch providers).
- `/network` takes ~5–12 s to show anything.
- Profile charts use a categorical x-axis, so missing years (2013–2016) silently disappear; "Average departure time 9:58 AM" looks suspicious for a dawn commute (check timezone/`start_date` vs `start_date_local`).
- Page titles: profile pages are titled with the generic site name, not the rider.
- Repo hygiene: `GEMINI.md`, `.agent/`, `swarm_session/`, `Egan Scraper.md` at root are leftovers from prior agent sessions. Decide keep/move/delete. There is no `CLAUDE.md`; create one as part of Phase 0 (stack, commands, conventions, "never point local dev at prod DB").
- Migration numbering skips `022`.

---

## 4. Constraints and context

- **Stack today:** TanStack Start (React 19, file routes in `app/routes`), TanStack Query/Table/Virtual, Vite 8, Cloudflare Workers via `@cloudflare/vite-plugin` (`wrangler.jsonc`, `nodejs_compat`), Supabase Postgres 17 (project `sf2g`, ref `dgoqjrfjrzewplwayhhz`, us-east-2), Strava OAuth + webhooks, PostHog, Recharts, Leaflet, pnpm. ~34k lines of TS.
- You may recommend changing any layer, but justify it against "preserve structure, features, table UX." A framework swap is a last resort; moving work into Postgres and background jobs is the expected direction.
- **Production data is real community data.** No plan step may write to prod except deliberate, reviewed migrations. Local dev currently points at **prod** (`.env.local`) because no dev project exists; **Phase 0 must create a dev path** (a `sf2g-dev` Supabase project on the free tier, and/or `supabase start` locally with seed data) and switch local dev to it.
- Phillip's GitHub auth on this machine is not yet set up (`gh auth login` pending); the implementing agent opens PRs once it is.
- Budget-sensitive: the Supabase org is on the Free plan. Call out any recommendation that costs money (Workers Paid, Supabase Pro, Queues) with the monthly cost, as a decision for Phillip.

---

## 5. Questions to put to Phillip before finalizing

Ask these (batch them, with your recommended answer first), then plan with the answers:

1. Which Cloudflare plan is the account on, and is $5/mo Workers Paid acceptable?
2. Names (or Strava profile links) of 2–3 riders whose rides are missing, starting with Simon, so the sync trace uses real cases.
3. The concrete table bugs he hits most (screenshots or repro steps).
4. Is it OK to require riders to re-authorize Strava if scopes or tokens need resetting?
5. Can leftover files (`GEMINI.md`, `.agent/`, `swarm_session/`) be deleted?

---

## 6. What to deliver

Write these files in `docs/rework/` on a branch, and open one PR titled "docs: rework plan" (or hand back the files if GitHub isn't set up yet):

- `01-findings.md` — root-cause analysis for P1–P4 with evidence (queries, logs, measurements, file:line refs). Separate *verified* from *hypothesis*.
- `02-architecture.md` — target architecture and an ADR-style entry per major decision (context, options, decision, consequences, cost).
- `phase-00-*.md`, `phase-01-*.md`, … — the implementation phases (template below). Expected rough order, but you decide:
  - **Phase 0 — Safety & foundation:** revoke anon RPC grants, dev database + seed data, `CLAUDE.md`, CI workflow (typecheck + existing tests), Playwright smoke test of every page.
  - **Phase 1 — Test harness:** local Supabase + fixture dataset, SQL/RPC test layer, component test setup, golden-number tests for the current leaderboard (characterization tests *before* refactoring).
  - **Phase 2 — Stop the 1102s:** move aggregation into Postgres, server-side pagination/sort, eliminate fetch-all loops, measure CPU.
  - **Phase 3 — Reliable sync:** webhook ack-then-enqueue, scheduler moved off GitHub Actions, sync health tracking + reauth prompts, backfill for missed rides, group-ride recompute on new rides.
  - **Phase 4 — Table foundation:** canonical query/URL state model, shared table shell, migrate tables one by one (one phase or sub-phase per table), fix the bug list.
  - **Phase 5 — Cleanup:** date/timezone audit, map tiles, network page performance, remaining advisor items, repo hygiene.
- `README.md` in `docs/rework/` — index with phase order, dependencies, and which phases can run in parallel.

### Phase file template (each must stand alone; the implementer won't have read this brief)

```markdown
# Phase NN — <title>

## Goal
One paragraph: what is true when this phase is done, in user-visible terms.

## Why
2–4 sentences linking to the root cause in 01-findings.md.

## Prerequisites
Phases that must be merged first; env/services needed (e.g., local Supabase running).

## Scope
- In: bullet list of exact files/areas to change or create.
- Out: what NOT to touch in this phase.

## Steps
Numbered, concrete, in order. Each step names files, functions, SQL objects.
Tests come first: "Write failing test X in <path>; then implement."

## Acceptance criteria
Checklist, each item objectively verifiable (command + expected output, page + expected number, metric + threshold).

## Verification
Exact commands to run (pnpm test, pnpm test:db, pnpm e2e, typecheck) and manual browser checks on localhost.

## Risks & rollback
What could break in prod; how to roll back (migration down, feature flag, revert).

## Size
Expected PR size; if > ~800 changed lines, split into NNa/NNb.
```

### Rules for the phase plans
- One phase = one PR = one agent session. No phase depends on unmerged work from another.
- Every phase leaves `main` deployable and every existing page working.
- Database changes are numbered migrations, tested locally first, applied to prod only through a deliberate step that names who approves it.
- Never point an implementation agent at production data; all work uses the dev/local database.
- Prefer characterization tests (pin current numbers) before changing a query, so "the numbers changed" is always intentional.

---

## 7. Starting points for your research

- `app/server/leaderboard.ts`, `alltime.ts`, `rides.ts`, `network.ts`, `group-rides.ts`, `sync.ts`, `cron.ts`, `webhook.ts`, `reclassify.ts`
- `app/routes/leaderboard.tsx`, `app/components/Leaderboard*.tsx`, `*Table.tsx`, `FilterChips.tsx`, `app/lib/useColumnResize.ts`
- `app/lib/constants.ts` (`CRON_SYNC_BUDGET`, rate limits), `app/lib/strava*.ts`, `app/lib/rate-limiter.ts`
- `supabase/migrations/*.sql` (34 files; views and RPCs live here)
- `.github/workflows/cron.yml`, `wrangler.jsonc`, `vite.config.ts`
- Git history: `git log --oneline` (73 commits; the 1102 fixes are instructive)
- Supabase MCP: `get_advisors`, `get_logs`, read-only `execute_sql` for row counts (ask before running anything against prod)
- Cloudflare dashboard / `wrangler tail` for real 1102 rates (needs Phillip's Cloudflare login)
