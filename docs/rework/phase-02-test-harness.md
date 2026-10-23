# Phase 02 — Test harness and characterization tests

## Goal
`pnpm test:db` runs the server functions against a local Postgres seeded with a deterministic fixture dataset and asserts exact numbers; `pnpm e2e` opens every page in a real browser; CI runs both. The current leaderboard numbers for the fixture are pinned as goldens so Phase 03 can prove it changed nothing by accident.

## Why
440 existing tests cover only pure functions; nothing can catch a wrong number on screen (F4.1). Phase 03 will rewrite every query — without goldens, regressions are invisible.

## Prerequisites
- Phase 00 (local Supabase, CI skeleton).

## Scope
- In: `supabase/seed/*.sql`, `app/test/` (helpers), `vitest.config.ts` (two projects: `unit` and `db`), `app/server/__test__/characterization/*.test.ts`, `app/components/__test__/setup`, `playwright.config.ts`, `e2e/*.spec.ts`, `.github/workflows/ci.yml` (db + e2e jobs), `package.json` scripts, dev deps (`@testing-library/react`, `@testing-library/user-event`, `happy-dom`, `msw`, `@playwright/test`, `postgres`).
- Out: any production code change other than making server functions callable from tests (see step 4).

## Steps
1. **Fixture dataset** `supabase/seed/010_fixture_users.sql`, `020_fixture_rides.sql`, `030_fixture_overrides.sql`. Generate with a checked-in script `scripts/gen-fixtures.ts` (seeded PRNG, fixed UUIDs) so it can be regenerated. Contents, per ADR-6: 8 riders (incl. one with 0 rides, one `deauthorized_at`, one empty `strava_scopes`); ~400 rides 2018–2026 covering all 7 routes + `other` + null category, weekends, PPR-at-dawn (`start_date` at 05:50–06:10 local through the PPR intercept polyline) and not, one reverse commute, `destination_company` for google and apple, one `is_hidden`, one `ride_overrides` row (route change) and one (`is_not_sf2g`), `summary_polyline`s copied from real route shapes in `app/lib/constants.ts`. Document the expected totals per rider in `supabase/seed/README.md` by hand (compute them independently — that is the point).
2. **DB test runner.** `vitest.config.ts` → `projects: [{ name: 'unit', include: ['app/**/__test__/**/*.test.ts', '!**/characterization/**'] }, { name: 'db', include: ['app/**/characterization/**', 'app/server/__test__/db/**'], globalSetup: 'app/test/db-global-setup.ts' }]`. Global setup: assert `supabase status` is up, run `supabase db reset` once, export env (`SUPABASE_URL=http://127.0.0.1:54321`, local anon + service keys). Scripts: `"test": "vitest run --project unit"`, `"test:db": "vitest run --project db"`.
3. **Refresh MVs in setup** (`refresh_leaderboard`, `refresh_ppr_dawn_rides`, `refresh_ride_co_occurrences`, `refresh_route_speed_leaderboard`, `refresh_company_leaderboard`) so view-backed paths have data.
4. **Call server functions directly.** TanStack `createServerFn` handlers can be invoked in Node by importing the module and calling `fn({ data })`; if the Start plugin blocks that outside Vite, extract each handler body into a plain exported `*Impl(data)` function in the same file and have the server fn call it (mechanical; no logic change). Characterization tests import the `Impl`s.
5. **Characterization goldens** in `app/server/__test__/characterization/`: for `fetchLeaderboard`, `fetchFilteredLeaderboard`, `fetchPprDawnRiderIds`, `fetchRiderGrowthData`, `fetchDailyGrowthData`, `fetchRouteSpeedLeaderboard`, `fetchCommunityBreakdown`, `fetchCompanyRiderIds`, `fetchAllTimeLeaderboard`, `fetchRidesLeaderboard`, `fetchUserRides`, `fetchCommunityStartHours`, `fetchCommunityStreaks`, `fetchRiderNetwork`, `fetchGroupRides`, `fetchGroupRideDetail`: call with a matrix of inputs (no filters; each route alone; weekends on/off; a date range; PPR; company; reverse; `other` on/off; two sort columns × dir; page 2) and `expect(result).toMatchSnapshot()`. Snapshot files are committed. Where two paths disagree for the same logical filter (F1.2), **record both** in a `KNOWN_DISCREPANCIES.md` with the inputs — these become Phase 03 acceptance items.
6. **Component test setup:** `app/test/setup-dom.ts` (happy-dom, Testing Library cleanup), a `renderWithProviders()` helper that mounts QueryClient + a memory router. One smoke test per existing table component rendering fixture rows (no behavior assertions yet — Phase 05 adds them).
7. **Playwright:** `e2e/pages.spec.ts` visits `/`, `/leaderboard` (+ `?view=rides`, `alltime`, `groups`), `/profile/<fixture id>`, `/group-rides/<fixture id>`, `/network`, `/routes`, `/should-i-sf2g`, `/privacy`; asserts HTTP 200, no `console.error`, no text "Hydration failed", and a per-page landmark (table has ≥ 1 row, map container exists, etc.). Run with `timezoneId: 'America/Los_Angeles'` **and** once with `'UTC'` to catch F5.1. `webServer: pnpm dev` with env pointing at local Supabase.
8. **CI:** `db` job: `supabase/setup-cli` action → `supabase start` → `pnpm test:db`; `e2e` job: Playwright browsers cached → `pnpm e2e`. Both required for merge.
9. Add `MSW` handlers for Strava (`/oauth/token`, `/athlete/activities`, `/activities/:id`, `/push_subscriptions`) in `app/test/strava-mocks.ts` — unused until Phase 04, but defined here so the harness is complete.

## Acceptance criteria
- [ ] `pnpm test:db` passes locally and in CI in < 3 min.
- [ ] `pnpm e2e` passes in both timezones; the `/should-i-sf2g` hydration failure is **expected to fail** in UTC — mark it `test.fail()` with a link to Phase 06 so the suite is green but the bug is tracked.
- [ ] Snapshot files exist for every server function listed in step 5.
- [ ] `KNOWN_DISCREPANCIES.md` lists at least the 573-vs-833 profile case (F3.2) with the exact inputs that reproduce it on the fixture.
- [ ] Hand-computed totals in `supabase/seed/README.md` match `leaderboard_view` for the fixture (this validates the fixture, not the app).

## Verification
```bash
pnpm db:start && pnpm db:reset
pnpm test && pnpm test:db && pnpm e2e
```

## Risks & rollback
- Server functions may not be importable outside Vite SSR; step 4's `Impl` extraction is the fallback and is safe.
- Snapshots can encode bugs — that is intended (characterization). Phase 03 changes them deliberately.

## Size
Large but mechanical: fixture generator (~300 lines), seeds (generated), ~16 test files, config. Split into **02a** (fixtures + db runner + goldens) and **02b** (component setup + Playwright + CI jobs) if the PR exceeds ~1,000 lines excluding generated SQL and snapshots.
