# Phase 06 — Cleanup: dates, maps, perf, polish

## Goal
No hydration errors in any timezone; `/routes` maps render real tiles; profile pages have proper titles and honest charts; the remaining Supabase advisor items are closed; the DevTools panel can no longer touch prod data from a local build.

## Why
Audit findings F5.1, F5.3, F5.4, F5.7 and the leftovers of F5.2/F5.5. Small individually; together they are the difference between "works" and "trustworthy".

## Prerequisites
- Phases 02 (e2e, timezone matrix) and 05a (`resolveDateRange`). Otherwise independent; can run in parallel with 03/04.

## Scope
- In: `app/routes/should-i-sf2g.tsx`, `2sf2g.tsx`, `app/lib/dates.ts` (new), `app/components/InteractiveMap.tsx`, `GatewayMap.tsx`, `GroupRideMap.tsx`, `ProfileFunStats.tsx`, `RideFrequencyChart.tsx`, `app/routes/profile/$userId.tsx` (`head()` title), `DevToolsPanel.tsx`, one migration for remaining advisor items, `docs/`.
- Out: tables, sync, aggregation.

## Steps
1. **Date audit.** Create `app/lib/dates.ts` with `todayInLA()`, `startOfWeekLA()`, `formatLocal(date, tz)`, all built on `Intl.DateTimeFormat` with explicit `timeZone`. `grep -rn "new Date()" app --include=*.tsx` and route every render-time usage through it or move it to a `useEffect`/client-only island. Fix `/should-i-sf2g` day pills (server and client must agree; simplest: compute pills from a `today` value passed in loader data, derived in LA time). Fix profile "Average departure time" to use `start_date` + `timezone` column (`extract_iana_timezone` exists in SQL) — compute in SQL in Phase 03c if not already. Flip the Phase 02 `test.fail()` on the UTC e2e run to a normal passing test.
2. **Maps.** Identify the tile URL in `InteractiveMap.tsx`/`GatewayMap.tsx`; switch to OpenStreetMap standard tiles or CARTO basemaps with proper attribution, or add the provider key via `VITE_MAP_TILE_KEY` if Phillip has one. E2E: assert no tile request returns 401/403 and no image contains "API KEY REQUIRED" (check a sample tile's response status).
3. **Profile charts.** Year axis becomes continuous (fill missing years with 0 or render a true time axis). Page `<title>` = `"<Rider> — SF2G"` via the route's `head()`.
4. **Advisors.** Migration: drop confirmed-unused indexes (after Phase 03 lands, re-check `pg_stat_user_indexes`); decide and document MV visibility (either keep `anon` SELECT for the ones the Phase 03 functions no longer need, or revoke them); rate-limit `/api/cron` admin endpoint (simple per-IP KV counter is paid; use a fixed shared secret + Cloudflare WAF rule instead and document it).
5. **DevTools safety.** `DevToolsPanel` write actions require `NODE_ENV !== 'production' ? local DB URL check : admin session` — specifically refuse to run when `SUPABASE_URL` is the prod project and the request origin is `localhost`.
6. **Docs:** `docs/ops/` with runbooks: applying migrations, rotating `CRON_SECRET`/Strava secrets, re-registering the webhook, reading `[perf]` logs, what to do when Strava rate-limits. Update `README.md` architecture table (Workers, not Pages; Cron Trigger; job table).

## Acceptance criteria
- [ ] `pnpm e2e` green in `America/Los_Angeles` and `UTC` with no `test.fail()` markers left.
- [ ] `/routes` shows real map tiles on prod; no "API KEY REQUIRED" text in any tile.
- [ ] Profile page tab title shows the rider's name; year chart shows every year 2012–2026.
- [ ] `get_advisors(security)` and `(performance)` return no WARN-level findings.
- [ ] Running the DevTools "Run All Cron Jobs" from a local build pointed at prod is refused with a clear message.

## Verification
```bash
pnpm e2e
pnpm dev  # visit /routes, /profile/<id>, /should-i-sf2g at ~6 pm Pacific
```

## Risks & rollback
Low; each item is isolated and revertible.

## Size
~500 lines across two PRs (06a dates + maps + charts; 06b advisors + DevTools + docs).
