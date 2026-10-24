# Architect Phase — Completion Report

**Agent**: Architect
**Phase**: 5 of 9 (Architect Design)
**Status**: ✅ Complete
**Date**: 2026-05-25

---

## Summary

Synthesized all four scout research documents and the project brief into a comprehensive system architecture document. The architecture covers all 11 required sections and provides enough detail for a Coder agent to build the complete MVP.

**Output artifact**: `docs/system_architecture.md` (comprehensive implementation blueprint)

---

## Key Architectural Decisions Made

### 1. Authentication: Custom Strava OAuth (No Supabase Auth)
Supabase does not have a built-in Strava OAuth provider. We handle the full OAuth 2.0 Authorization Code Grant flow manually using TanStack Start server functions. Session state is managed via signed HTTP-only cookies.

### 2. Database Access: Dual Supabase Clients
- **Anon client** (respects RLS) → public reads (leaderboard, ride data)
- **Service role client** (bypasses RLS) → server-side writes (user upsert, ride insert, token storage)

### 3. Sync Strategy: Polling on Login + Manual Trigger
No webhooks for MVP. Users sync rides when they log in (automatic) or click "Sync Now" (manual). Incremental sync uses the `after` parameter.

### 4. Route Classification: 3-Layer Algorithm
1. **Segment matching** (primary, highest confidence)
2. **GPS corridor bounding boxes** (fallback)
3. **Elevation heuristics** (tiebreaker)

### 5. Frontend: Vanilla CSS with Custom Properties
No CSS framework. CSS custom properties enable dark/light mode toggle with minimal code. Mobile-first responsive design.

### 6. Leaderboard: Materialized View + Virtualized Table
PostgreSQL materialized view (`leaderboard_view`) pre-computes rankings. Refreshed after each sync. TanStack Table + Virtual renders thousands of rows efficiently.

---

## Side Quests Included in MVP
- ✅ Dark/light mode toggle (CSS custom properties)
- ✅ Mobile responsive (CSS breakpoints)
- ✅ Accessibility baseline (semantic HTML, ARIA, keyboard nav)
- ✅ Easy rollback (Vercel deployment model)

## Side Quests Deferred
- ❌ Strava API scraping fallback (ToS violation, not needed)
- ❌ Supabase MCP (no user-facing value)
- ❌ IndexedDB fallback (excessive complexity for MVP)

---

## Blocking Items for Coder Phase

| # | Blocker | Owner |
|---|---------|-------|
| 1 | Create Supabase project and provide credentials | User |
| 2 | Register Strava API app and provide Client ID / Secret | User |
| 3 | Verify segment ID → corridor mapping for the 13 known segments | User / Community |

---

## Architecture Document Stats

| Section | Content Summary |
|---------|----------------|
| System Overview | Mermaid diagrams (architecture + data flow), component inventory |
| Project Structure | 40+ files with purposes and exports, complete dependency list |
| Database Schema | 3 tables, 1 materialized view, 1 regular view, RLS policies, triggers, seed data |
| Authentication | 4-step OAuth flow with complete TypeScript implementation |
| API Layer | 8 server functions with signatures, dual Supabase client config, rate limiter |
| Data Sync | Paginated sync with rate limiting, batch upsert, error handling |
| Route Classification | 3-layer algorithm with full pseudocode, bounding boxes, segment mapping |
| Frontend | Route tree (5 pages), component hierarchy, column definitions, query cache structure |
| Side Quests | 7 decisions with rationale |
| Deployment | Vercel config, env vars, CI/CD, migration workflow |
| Open Decisions | 3 blocking, 5 deferrable |

---

## Next Step

→ **Planner Phase**: Take this architecture document and break it into ordered implementation tasks for the Coder agent. Each task should be a self-contained unit of work with clear inputs, outputs, and acceptance criteria.
