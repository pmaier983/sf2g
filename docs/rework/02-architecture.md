# 02 — Target architecture and decisions

Written 2026-10-22. Constraints from Phillip: stay on Cloudflare Free and Supabase Free; avoid making riders re-authorize; preserve site structure, features, and table UX; full rework of plumbing is acceptable.

## The one-paragraph version

Keep TanStack Start on Cloudflare Workers for rendering and keep Supabase Postgres as the system of record. Move **every aggregation into Postgres** behind parameterized RPCs that accept a single validated `TableQuery` and return only the page the UI renders, so a Worker request makes ≤ 3 subrequests and does no data-proportional CPU work. Move **all Strava I/O out of request handlers** into a job table drained by a Cloudflare Cron Trigger in small, CPU-measured batches, with the webhook doing nothing but "insert a job row and return 200". Put a **real test pyramid** under it: a local Supabase with a fixture dataset, SQL-level golden tests, component tests for a shared table shell, and Playwright smoke tests, all in CI.

---

## ADR-1 — Where aggregation happens

**Context.** F1.1/F1.2: Worker code pages whole tables (18 pages of `rides` per leaderboard view) and aggregates in JS under a 10 ms CPU / 50-subrequest cap. Three code paths compute the same numbers differently.

**Options.**
1. Keep JS aggregation, cap harder (status quo; 8 commits of this already).
2. Precompute *everything* into materialized views refreshed on sync. Fast reads, but every filter combination (routes × dates × weekends × PPR × company × reverse × other) would need its own MV, or the Worker is back to filtering in JS.
3. **Parameterized SQL functions** (`get_leaderboard(query jsonb)` etc.) over indexed base tables and a few summary tables, returning the exact page requested; MVs kept only for genuinely expensive derived data (`ride_co_occurrences`).

**Decision.** Option 3. Postgres at 65k rows answers these in tens of milliseconds; the Worker becomes a thin validator/forwarder. One function per table/chart, each taking the same `TableQuery` shape (ADR-4), each returning `{ rows, total }`.

**Consequences.** SQL becomes the place where "what counts as an SF2G ride", weekend exclusion, PPR-at-dawn, and `other` handling are defined — *once*. Requires the SQL test layer (ADR-6). Removes `fetchFilteredLeaderboard`, the JS median/streak/start-hour code, and client-side PPR/company set intersection.

**Cost.** $0.

---

## ADR-2 — Where Strava sync runs

**Context.** F2.1–F2.4: the scheduler is a dangling promise; GitHub Actions is unreliable; initial syncs truncate; the webhook works inline. Budgets: Worker 10 ms CPU and 50 subrequests per invocation; Strava 100 reads/15 min and 1,000/day for the whole app; 70 riders.

**Options.**
1. Make `/api/cron` await the work inline and have GitHub Actions call it repeatedly. Works within limits if each call does ≤ 6 users; still depends on GitHub's best-effort schedule. **Good enough as a hotfix.**
2. **Cloudflare Cron Trigger** (`scheduled` handler in the same Worker) every 5 minutes draining a `sync_jobs` table: N jobs per tick sized to stay under 45 subrequests and ~8 ms CPU. One runtime, one codebase, free (5 triggers/account).
3. Supabase Edge Function scheduled by `pg_cron` (+ `pg_net`). No subrequest cap, runs next to the DB, but a second runtime (Deno) and the classifier/Strava code must be shared across runtimes.
4. Cloudflare Queues — paid only. Out.

**Decision.** Option 1 immediately (Phase 1). Option 2 as the target (Phase 4), with a **decision gate**: Phase 4a includes a spike that measures CPU per activity for parse + classify in the Worker. If a batch of ~50 activities cannot be classified under ~8 ms, fall back to Option 3 for the drain step only; the job table and webhook design are identical either way.

**Sync model.**
- `sync_jobs(id, user_id, kind ∈ {webhook_activity, incremental, backfill}, payload jsonb, cursor jsonb, run_after, attempts, last_error, status)`.
- Webhook: validate → `INSERT` job → 200. One subrequest, no Strava calls.
- Cron tick: claim ≤ N due jobs (`FOR UPDATE SKIP LOCKED`), process, write results, re-enqueue with cursor if more pages remain (backfill resumes instead of dying at page 5), exponential backoff on failure, and a per-user `sync_state` row (`last_success_at`, `last_error`, `needs_reauth`).
- Daily sweep job enqueues one `incremental` job per active user, spread across the day so Strava reads stay ≈ 70 × 2 × (sweeps/day) < 1,000.
- Webhook-first means most new rides arrive within one tick; the sweep is the backstop.

**Consequences.** The GitHub Actions cron is deleted. Sync health becomes queryable (and shown in DevTools + a "Reconnect Strava" banner only for `needs_reauth` users — currently 1 of 70). Requires a custom Worker entry that exports both the TanStack Start `fetch` handler and `scheduled` (verify in Phase 4a that `@cloudflare/vite-plugin` + `@tanstack/react-start/server-entry` allow wrapping; if not, a second tiny Worker in the same repo sharing `app/server/sync-core` is acceptable).

**Cost.** $0.

---

## ADR-3 — Re-authorization policy

**Decision.** Never prompt for re-auth unless `strava_scopes` lacks `activity:read_all` or Strava returns `invalid_grant` on refresh. Refresh tokens survive disuse (F2.5), so restoring the scheduler reconnects 69 riders silently. Deauthorized users (`deauthorized_at`) are excluded from sweeps.

---

## ADR-4 — One query model for all tables

**Context.** F3.1/F3.3. 23 loose URL fields, hand-parsed; different sort keys per view; filters applied in different layers.

**Decision.** A single `TableQuery` schema (Zod — add as a dependency; it is the one new runtime dep) defined in `app/lib/table-query.ts`:

```ts
{
  view: 'riders' | 'rides' | 'alltime' | 'groups' | 'profile-rides',
  routes: RouteCategory[], includeOther: boolean,
  dateFrom?: string, dateTo?: string, preset?: 'today'|'week'|'30d'|'month'|'6m'|'365d'|'year'|'all',
  excludeWeekends: boolean, pprDawn: boolean, reverse: boolean,
  company?: DestinationCompany, riders?: string[], search?: string,
  sort: { column: string, dir: 'asc'|'desc' }, page: number, pageSize: number,
}
```

- **URL is the source of truth.** `useTableQuery()` parses/serializes with the schema; defaults are omitted from the URL; invalid values fall back to defaults instead of throwing.
- **The same object crosses the wire.** Each server function is `createServerFn().validator(TableQuery).handler(q => supabase.rpc('get_<view>', { q }))`. Sort columns are validated against a per-view allow-list in TS *and* in SQL.
- **Dates are computed in one place** — presets resolve to `dateFrom/dateTo` in `America/Los_Angeles` on the server, never from `new Date()` during render (F5.1).

**Consequences.** `LeaderboardSearch`, `SEARCH_DEFAULTS`, the hand-written `validateSearch`, and the per-view `sort/rSort/gSort` triplication go away. `page`/`gPage` collapse into `page` keyed by view.

---

## ADR-5 — Table component structure

**Decision.** Keep TanStack Table + TanStack Virtual (they are not the problem). Introduce one shared `<DataTable>` shell in `app/components/table/` that owns: virtualization, sticky header, column resize (`useColumnResize`), sort indicators, density, loading/empty/error states, and keyboard focus. Each table becomes `columns.ts` (pure column defs: accessor, header, cell formatter, unit-aware) + a thin `XTable.tsx` that binds a `TableQuery` to a query hook and the shell. Visual CSS stays as is. Mobile and desktop controls render **one** DOM instance, switched by CSS, not duplicated (F3.2).

---

## ADR-6 — Test strategy

| Layer | Tool | What it proves | Runs where |
|---|---|---|---|
| SQL / RPC | Vitest + `postgres` client against **local Supabase** (`supabase start`, Postgres 17 to match prod) seeded from `supabase/seed/*.sql` | Every `get_*` function returns exact golden numbers for a fixture dataset covering all routes, weekends, PPR, reverse, companies, overrides, hidden rides | `pnpm test:db`, CI |
| Server functions | Vitest + MSW mocking Strava; local Supabase | Sync/webhook/backfill semantics: idempotent upserts, cursor resume, backoff, token rotation | `pnpm test:db`, CI |
| Pure logic | existing Vitest | classifier, clustering, date presets, `TableQuery` parsing | `pnpm test`, CI |
| Components | Vitest + Testing Library + happy-dom | `<DataTable>` shell, column formatting, filter chips ↔ `TableQuery` round-trip | `pnpm test`, CI |
| E2E | Playwright against `pnpm dev` + local Supabase | Every page loads without console errors; each filter chip changes the table and the URL; profile and group-ride pages open; no hydration errors in a fixed timezone | `pnpm e2e`, CI |

**Characterization first.** Before Phase 3 touches a query, Phase 2 pins the *current* outputs of each server function for the fixture dataset. When the SQL versions land, the goldens are either identical (great) or updated deliberately with a reason in the PR.

**Fixture dataset.** ~8 riders, ~400 rides spanning 2018–2026, every route including `other`, weekend rides, PPR-at-dawn and not, a reverse commute, two company destinations, a hidden ride, an override, two users without rides, one deauthorized user, one empty-scope user. Deterministic IDs so goldens are stable.

---

## ADR-7 — Environments

- **Local:** `supabase start` (Docker) is the default dev database. `pnpm db:reset` applies migrations + seed. `.env.local` points at `http://127.0.0.1:54321`. Local dev never touches prod.
- **Staging (optional):** a free `sf2g-dev` Supabase project, created by Phillip in the dashboard, for sharing previews. Same migrations.
- **Prod:** migrations applied via `supabase db push --linked` from a reviewed PR, by Phillip, never by an agent session on its own.
- Fix `supabase/config.toml` `major_version` to 17.

---

## ADR-8 — What stays exactly as it is

TanStack Start, React 19, Vite, Cloudflare Workers deploy, Supabase, Strava OAuth flow, PostHog, Recharts, Leaflet, vanilla CSS and the visual design, the route structure (`/leaderboard` with four views, `/profile/$userId`, `/group-rides/$id`, `/network`, `/routes`, `/should-i-sf2g`, `/privacy`), pnpm, Husky/lint-staged. The rework replaces plumbing under these, not the product.

---

## Decisions that cost money (none chosen)

| Option | Cost | Why not needed |
|---|---|---|
| Workers Paid | $5/mo | ADR-1 removes data-proportional CPU; ADR-2 keeps ticks tiny |
| Cloudflare Queues | Paid plan | Job table + Cron Trigger covers it at this scale |
| Supabase Pro | $25/mo | 65k rows, low traffic; free tier is fine |
