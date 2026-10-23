# SF2G — notes for coding agents

SF2G (sf2ging.com) is a leaderboard for the SF2G bike-commuting community. Riders connect Strava; rides are synced, classified into route corridors, and ranked.

## Stack

- TanStack Start (React 19, file routes in `app/routes`), TanStack Query / Table / Virtual, Vite
- Deployed to **Cloudflare Workers, Free plan**: 10 ms CPU and 50 subrequests per invocation. Every Supabase REST call and every Strava call is one subrequest.
- Supabase Postgres 17 (Free plan). Strava OAuth + webhooks. PostHog. Recharts, Leaflet. Vanilla CSS.
- pnpm. Husky runs prettier on commit and `typecheck && test` on push.

## Commands

```bash
pnpm db:start      # local Supabase in Docker (Colima works: `colima start`)
pnpm db:reset      # re-apply all migrations + seed
pnpm dev           # http://localhost:5173 against the local DB
pnpm typecheck
pnpm test          # unit tests (Vitest)
pnpm build
pnpm db:types      # regenerate app/lib/database.types.ts from the local DB
```

## Where things live

- `app/server/*` — server functions (`createServerFn`); the only code that talks to Supabase or Strava
- `app/lib/*` — pure logic (classifiers, utils, types); `app/lib/public-user.ts` is the only allowed `users` column list for browser-reachable reads
- `app/components/*`, `app/routes/*` — UI
- `supabase/migrations/NNN_*.sql` — schema, views, RPCs (numbered, append-only)
- `docs/rework/` — the current rework plan; start at `docs/rework/README.md`

## Rules

1. **Local database only.** `.env.local` must point at `http://127.0.0.1:54321`. Never use the production project (`dgoqjrfjrzewplwayhhz`) from local dev, tests or scripts that write.
2. **Migrations reach prod only via Phillip** (`supabase db push --linked`) after review. Note any required deploy order in the migration header.
3. **Never return secrets to the browser.** No `select("*")` on `users` with the anon client; use `PUBLIC_USER_COLUMNS`. Admin/maintenance server functions start with `await assertAdmin()` (`app/lib/admin.ts`); sessions are HMAC-signed (`app/lib/session.ts`).
4. **No data-proportional work in request handlers.** Aggregate in SQL; a server function making more than 3 Supabase requests is a bug.
5. **Tests first.** Write the failing test, then the fix. Changing a golden number needs a sentence in the PR explaining why the new number is right.
6. Never commit `.env*.local`. Keep PRs to one phase/sub-phase.
