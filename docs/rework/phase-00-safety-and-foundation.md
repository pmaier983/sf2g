# Phase 00 — Safety & foundation

## Goal
Production is no longer writable through the public anon key; the repo has a `CLAUDE.md`, a CI workflow that runs typecheck and the existing tests on every PR, and a local Supabase that any developer or agent can start without touching prod. No user-visible change.

## Why
Supabase advisors flag five `SECURITY DEFINER` functions (including `batch_update_ride_classifications`, which rewrites ride classifications) as executable by `anon`, and the anon key ships in the browser bundle (findings F5.2). Local dev currently points at the production database because no alternative exists (F5.6). There is no CI (F4.1).

## Prerequisites
- Docker Desktop installed (for `supabase start`).
- Phillip applies the migration to prod after review (see Steps 2–3).

## Scope
- In: `supabase/migrations/036_lock_down_rpcs.sql`, `supabase/config.toml`, `supabase/seed/`, `package.json` scripts, `.github/workflows/ci.yml`, `CLAUDE.md`, `.env.example`, `README.md` (dev section), repo root cleanup.
- Out: any application code, any query change, any table change.

## Steps
1. **Confirm callers.** `grep -rn "rpc(" app/` — verify every call to `batch_update_ride_classifications`, `refresh_leaderboard`, `refresh_company_leaderboard`, `refresh_ppr_dawn_rides`, `refresh_ride_co_occurrences`, `refresh_route_speed_leaderboard` goes through `createServiceClient()` (service role). Record the list in the PR description.
2. **Migration `036_lock_down_rpcs.sql`:**
   ```sql
   REVOKE EXECUTE ON FUNCTION public.batch_update_ride_classifications(jsonb) FROM anon, authenticated, public;
   REVOKE EXECUTE ON FUNCTION public.refresh_leaderboard() FROM anon, authenticated, public;
   -- same for refresh_company_leaderboard, refresh_ppr_dawn_rides, refresh_ride_co_occurrences, refresh_route_speed_leaderboard
   -- pin search_path on all 10 flagged functions:
   ALTER FUNCTION public.refresh_leaderboard() SET search_path = public;  -- etc.
   CREATE INDEX IF NOT EXISTS idx_ride_overrides_user_id ON public.ride_overrides(user_id);
   ```
   `get_leaderboard_by_date_range` and `get_user_ride_totals` are read RPCs used with the anon client — leave them.
3. **Apply locally first** (step 6 gives you the local DB), then Phillip runs `supabase db push --linked` for prod. Re-run `get_advisors(security)` and confirm the `anon_security_definer_function_executable` and `function_search_path_mutable` findings are gone.
4. **Local Supabase.** In `supabase/config.toml` set `[db] major_version = 17`. Add scripts:
   ```json
   "db:start": "supabase start",
   "db:stop": "supabase stop",
   "db:reset": "supabase db reset",
   "db:types": "supabase gen types typescript --local > app/lib/database.types.ts"
   ```
   Set `[db.seed] sql_paths = ["./seed/*.sql"]` and create `supabase/seed/000_placeholder.sql` (the real fixture dataset arrives in Phase 02). Verify `pnpm db:reset` applies all 35 migrations cleanly on Postgres 17 — fix any migration that fails on a clean DB (document the fix in the PR).
5. **`.env.example`:** add `CRON_SECRET`, local Supabase defaults (`SUPABASE_URL=http://127.0.0.1:54321`, the local anon/service keys printed by `supabase start`), and a loud comment: *never point local dev at the production project*.
6. **`CLAUDE.md`** (≤ 80 lines): stack, commands (`pnpm dev`, `test`, `test:db` (coming), `typecheck`, `db:*`), where things live (`app/server` = server functions, `app/lib` = pure logic, `supabase/migrations` = schema), rules: local DB only; migrations are numbered and applied to prod only by Phillip; tests first; never commit `.env.local`; link to `docs/rework/README.md`.
7. **CI `.github/workflows/ci.yml`:** on `pull_request` and `push` to `main`: pnpm install (cache), `pnpm typecheck`, `pnpm test`, `pnpm build`. Add a `db` job placeholder that Phase 02 fills in (`supabase start` + `pnpm test:db`). Make `typecheck` work on a clean checkout: add `"postinstall": "tsr generate"` or commit `app/routeTree.gen.ts` (check which the TanStack version expects; currently a fresh clone fails typecheck until `pnpm dev` runs).
8. **Repo hygiene:** delete `GEMINI.md`, `.agent/`, `swarm_session/`, `Egan Scraper.md` (Phillip approved deletion on 2026-10-22 only if asked — **ask in the PR**; if no answer, move them to `docs/archive/`). Rename nothing else.
9. Update `README.md` "Getting Started" to the local-Supabase flow.

## Acceptance criteria
- [ ] `get_advisors(type=security)` on prod shows 0 `anon_security_definer_function_executable` and 0 `function_search_path_mutable` findings.
- [ ] `curl -X POST "$SUPABASE_URL/rest/v1/rpc/refresh_leaderboard" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"` returns 401/403, not 204.
- [ ] Fresh clone → `pnpm install && pnpm db:start && pnpm db:reset && pnpm typecheck && pnpm test` all pass with no manual steps.
- [ ] CI runs on a PR and is green.
- [ ] `CLAUDE.md` exists and says local DB only.

## Verification
```bash
pnpm db:start && pnpm db:reset
pnpm typecheck && pnpm test && pnpm build
pnpm dev   # with .env.local pointing at 127.0.0.1:54321 — pages load (empty data is fine)
```

## Risks & rollback
- Revoking EXECUTE from a function the app calls with the anon client would break that feature. Step 1 prevents this; rollback is `GRANT EXECUTE ... TO anon, authenticated` in a follow-up migration.
- A migration that only ever ran on prod may fail on a clean Postgres 17 — fix forward in this PR; do not edit already-applied migrations' semantics.

## Size
~300 lines, mostly config and docs. One PR.
