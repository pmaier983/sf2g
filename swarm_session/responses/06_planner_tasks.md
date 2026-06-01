# Planner Phase — Completion Report

> Agent: Planner
> Date: 2026-05-25
> Status: ✅ Complete

## What Was Done

Read and analyzed the complete system architecture (1620 lines) and broke it down into **13 ordered implementation tasks** that a Coder agent can execute sequentially.

## Artifacts Produced

- **Implementation Plan**: `swarm_session/docs/implementation_plan.md`
  - 13 tasks with IDs, descriptions, file lists, dependencies, inputs, and acceptance criteria
  - Dependency graph (Mermaid)
  - Execution summary table

## Task Breakdown Summary

| # | Task | Complexity | Key Files |
|---|------|-----------|-----------|
| 01 | Project Scaffold | S | package.json, app.config.ts, tsconfig.json, entry points |
| 02 | Database Schema & Supabase | M | 001_initial_schema.sql, supabase.ts, database.types.ts |
| 03 | Constants & Utils | M | constants.ts, polyline.ts, rate-limiter.ts |
| 04 | Session Management | S | session.ts |
| 05 | Strava OAuth & Auth | L | strava-oauth.ts, server/auth.ts, server/users.ts |
| 06 | Route Classifier | M | route-classifier.ts |
| 07 | Sync Pipeline | L | strava.ts, server/sync.ts |
| 08 | Leaderboard & Rides API | M | server/leaderboard.ts, server/rides.ts, queries/*.ts |
| 09 | Root Layout & Nav | M | __root.tsx, NavBar, ThemeToggle, Footer, CSS |
| 10 | Landing Page | M | index.tsx, RouteTag.tsx |
| 11 | Auth Pages | S | auth/login.tsx, auth/callback.tsx |
| 12 | Leaderboard Page | L | leaderboard.tsx, LeaderboardTable, LeaderboardColumns, SyncStatus |
| 13 | Profile Page | M | profile/$userId.tsx, RideFrequencyChart, RideCard |

## Key Design Decisions in Task Ordering

1. **TASK-03 before TASK-06**: Constants (gateway coords) and utilities (polyline decoder) must exist before the route classifier can use them.
2. **TASK-04 before TASK-05**: Session management is a dependency of auth — can't set cookies without session helpers.
3. **TASK-05 before TASK-07**: Can't sync rides without valid tokens from the auth system.
4. **TASK-06 before TASK-07**: Sync pipeline calls `classifyRoute()` for each activity.
5. **TASK-08 before TASK-09**: Root layout needs `currentUserQueryOptions` to show login/avatar state.
6. **TASK-12 is the climax**: Largest frontend task, depends on backend (sync), data (leaderboard), and shell (layout).

## Critical Path

```
T01 → T02 → T03 → T06 → T07 → T12
```
6 tasks on the longest dependency chain. The Coder should prioritize this path.

## Notes for Coder Agent

- **All credentials are in `.env.local`** — already created and gitignored. Do NOT create a new one.
- **Route classification uses GPS gateways, NOT Strava segments**. There is no `route_segments` table.
- **Strava READ rate limits are 100/15min and 1000/day** — more restrictive than overall limits.
- **Use `pnpm`** as the package manager (not npm, not yarn).
- **Deploy to Cloudflare Pages** (NOT Vercel). Use `preset: 'cloudflare-pages'` and add `wrangler.toml` with `nodejs_compat`.
- **Rate limiter is stateless** — Cloudflare Workers reset in-memory state. Rely on Strava's 429 + retry.
- **`database.types.ts` must be hand-written** since we can't run `supabase gen types` during build. Write types that match the SQL exactly.
- **`display_name` is a generated column** in PostgreSQL — do NOT include it in INSERT/UPDATE operations.
- **Service client for writes, anon client for reads** — this is the Supabase access pattern.

## Next Step

→ Launch **Coder agent** to execute TASK-01 through TASK-13 in order.
