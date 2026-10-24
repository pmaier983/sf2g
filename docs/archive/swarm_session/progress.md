# Progress Log

## Session: SF2G Commute Tracker MVP
Started: 2026-05-25
Status: coder_complete

## Pipeline Plan
1. ~~Scout Phase (Parallel)~~ ✅ — Research complete
2. ~~Architect Phase~~ ✅ — System design complete
3. ~~Planner Phase~~ ✅ — Implementation plan created
4. ~~Coder Phase~~ ✅ — Application built (14 tasks implemented)
5. **Reviewer Phase** ← NEXT — Adversarial code review

## Completed Steps
- [x] Session setup — created folder structure and project brief
- [x] Scout A: Strava API research → docs/strava_api_research.md, responses/01_scout_strava_api.md
- [x] Scout B: SF2G routes deep-dive → docs/sf2g_routes_research.md, responses/02_scout_sf2g_routes.md
- [x] Scout C: TanStack + Supabase research → docs/tech_stack_research.md, responses/03_scout_tech_stack.md
- [x] Scout D: Pagemilling analysis → docs/pagemilling_analysis.md, responses/04_scout_pagemilling.md
- [x] Architect: System design → docs/system_architecture.md, responses/05_architect_design.md
- [x] Planner: Implementation plan → docs/implementation_plan.md
- [x] Coder: Build application (14 tasks, all files in app/ and supabase/)
- [ ] Reviewer: Code review (NEXT)

## Key Architectural Decisions

### Authentication
- Custom Strava OAuth (no Supabase Auth — no built-in Strava provider)
- Signed HTTP-only cookies for session management
- Server-side token storage, auto-refresh with 5-min buffer

### Database
- 3 tables: `users`, `rides`, `route_segments`
- 1 materialized view: `leaderboard_view` (CONCURRENTLY refreshable)
- 1 regular view: `monthly_ride_stats` (for charts)
- RLS: Public reads, deny anon writes, service role for all mutations
- `display_name` is a generated column: `COALESCE(first_name || ' ' || last_name, ...)`

### Sync Strategy
- Polling only for MVP (webhooks deferred)
- Auto-sync on login, manual "Sync Now" button
- Incremental via `after` epoch parameter
- Batch upsert in groups of 100 (idempotent via UNIQUE strava_activity_id)

### Route Classification
- 3-layer: Segment matching → GPS corridor bounding boxes → Elevation heuristic
- Segment ID mapping stored in `route_segments` table
- Confidence scoring (0.0–1.0) with method tracking

### Frontend
- 5 routes: `/`, `/leaderboard`, `/auth/login`, `/auth/callback`, `/profile/$userId`
- Vanilla CSS with custom properties (dark/light mode)
- TanStack Table + Virtual for leaderboard
- Recharts for ride frequency charts
- Mobile-first responsive design

### Side Quests
- ✅ MVP: Dark/light mode, mobile responsive, accessibility baseline, easy rollback (Cloudflare Pages)
- ❌ Deferred: Strava scraping (ToS), Supabase MCP, IndexedDB fallback

## ✅ Resolved Blocking Items
1. **Supabase project** — Created (ref: `dgoqjrfjrzewplwayhhz`)
2. **Strava API app** — Registered (Client ID: `251048`)
3. **Route classification** — GPS gateway checkpoints (no segment IDs needed)

## Next Steps
- Verify dev server runs cleanly (`pnpm dev`)
- Apply SQL migration to Supabase
- Test Strava OAuth flow end-to-end
- Deploy to Cloudflare Pages
