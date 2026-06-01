# Scout Report: Tech Stack Research

> **Agent**: Scout (Tech Stack)
> **Status**: ✅ Complete
> **Date**: 2026-05-25

---

## Summary of Key Findings

### TanStack Start
- Full-stack React framework built on TanStack Router + Nitro server runtime
- Setup via `npx create-start-app@latest`
- File-based routing with `createFileRoute` convention in `app/routes/`
- **Server functions** (`createServerFn`) replace API routes — server-only code callable from client
- SSR with route loaders, streaming support, and hydration
- Deploys to Vercel/Netlify/Cloudflare via Nitro presets

### TanStack Table + Virtual
- Headless table library — bring your own UI
- Combine with `@tanstack/react-virtual` for virtualized scrolling
- Built-in sorting, filtering, and pagination

### TanStack Query + Supabase
- Use `queryOptions()` factory pattern for typed, reusable queries
- Optimistic updates via `onMutate` + rollback on error
- Cache invalidation: invalidate `['rides']` + `['leaderboard']` after sync

### Supabase
- Schema: `users` + `rides` + `leaderboard` (materialized view)
- RLS: Public read for leaderboard, owner-only writes, service role for server-side sync
- **Strava OAuth**: Must be handled manually (no built-in Strava provider)
- Generated TypeScript types via `npx supabase gen types typescript`
- Two clients: `supabase` (anon key) + `supabaseAdmin` (service role)

### Charting Library
- **Recommended: Recharts** — Simple declarative API, good TypeScript, time-series support
- Runner-up: Tremor (if using Tailwind CSS)

---

## TanStack Start Maturity Concerns

| Concern | Severity | Mitigation |
|---------|----------|------------|
| Relatively new (1.0 in late 2025) | ⚠️ Medium | Pin exact versions |
| Documentation gaps | ⚠️ Low | Community Discord is active |
| Deployment edge cases | ⚠️ Low | Vercel preset well-tested |
| Smaller ecosystem vs Next.js | ⚠️ Low | TanStack Router/Query have large ecosystems |

**Overall Assessment**: Suitable for SF2G. Can migrate to Vite SPA if a blocker is hit.

---

## Open Questions for the Architect

1. **Strava OAuth Session Management**: Use Supabase Auth JWTs or custom httpOnly cookies?
2. **Strava Token Storage Security**: Same table or separate with tighter RLS?
3. **CSS Framework Decision**: Tailwind CSS? Affects charting library choice.
4. **Materialized View Refresh Strategy**: After every sync, on cron, or on-demand?
5. **Route Classification Location**: Postgres function, server function, or background job?
6. **Deployment Target**: Vercel (recommended)?
7. **Rate Limits**: Queue/job system or sequential pagination for MVP?
8. **Package Manager**: Yarn (per CLAUDE.md) or npm (TanStack Start default)?

---

## Full Research Document

See: `/Users/phillipmaier/Desktop/Code/sf2g/swarm_session/docs/tech_stack_research.md`
