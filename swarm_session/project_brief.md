# Project Brief: SF2G Commute Tracker

## Goal

Build a competitive cycling commute tracking web application for the SF2G community. Riders log in via Strava OAuth, their ride history is automatically synced, and a virtualized leaderboard shows community-wide rankings. The system intelligently classifies commutes into route categories (Bayway, Skyline, Half Moon Bay Way, El Camino Real) based on GPS/segment data.

## Context

### What is SF2G?

SF2G (San Francisco to Google, colloquially "SF to the Peninsula") is a cycling commuter community. Riders bike from various starting points in San Francisco to workplaces on the Peninsula (Palo Alto, Mountain View, etc.). There are four primary route corridors:

1. **Bayway** — Bay Trail route along the eastern shoreline
2. **Skyline** — Skyline Blvd through the hills
3. **Half Moon Bay Way (HMBW)** — Coastal Highway 1 route
4. **El Camino Real (Royale)** — El Camino Real boulevard route

Each corridor has many variations with specific climbs and detours. The official reference is https://sf2g.com/.

### Existing Work

- **Egan Scraper** — A TypeScript/Node.js system that scrapes Strava segment data, filters results, uploads to S3, and displays via a Route Viewer (Next.js/React on Vercel). See `Egan Scraper.md` for full documentation.
- **Pagemilling** — A similar community project (https://pagemilling.com/, https://github.com/maugt/pagemilling) that tracks cycling commutes with leaderboards.
- **SF2G website** — The official community site at https://sf2g.com/ with route maps, descriptions, and community info.

### Repository

This project lives at `/Users/phillipmaier/Desktop/Code/sf2g`. The application has been built with TanStack Start, Vite, and Supabase.

## Tech Stack (User Specified)

### Frontend
- **TanStack Start** (https://tanstack.com/start/latest) — Full-stack React framework
- **TanStack Query** (https://tanstack.com/query/latest) — Data fetching/caching
- **TanStack Table** (https://tanstack.com/table/latest) — Virtualized leaderboard table
- **React** — UI framework
- **TypeScript** — Strict mode

### Backend
- **Supabase** — Backend-as-a-service (auth, database, API)
  - PostgreSQL database for ride storage
  - Row Level Security for data access
  - Typesafe API calls from FE (reference pattern: https://github.com/pmaier983/Blog)
  - Supabase MCP integration if possible (https://supabase.com/docs/guides/ai-tools/mcp)

### Authentication
- **Strava OAuth 2.0** — Primary login method
  - OAuth2 authorization code flow
  - Token refresh mechanics
  - Rate limiting awareness (100 requests / 15 minutes for the Strava API)

### External APIs
- **Strava API v3** (https://developers.strava.com/docs/reference/)
  - GET /athlete — User profile
  - GET /athlete/activities — Activity list (paginated)
  - Activity details including GPS data, segments, timestamps

## MVP Features (Priority Order)

1. **Strava OAuth Login** — Users authenticate via Strava
2. **Ride Sync** — Fetch all rides for new users; only new rides for returning users
3. **Ride Storage** — Persist rides in Supabase PostgreSQL
4. **Leaderboard Table** — Virtualized TanStack Table showing community rankings
5. **Route Classification** — Categorize commutes into Bayway/Skyline/HMBW/Royale

## Side Quests (Include if Simple, Defer if Complex)

- **Strava API fallback** — Scrape user profile if API fails
- **Supabase MCP** — Connect to the Supabase MCP server for AI tooling
- **Dark/Light mode** — Theme toggle
- **Mobile responsive** — Works on all screen sizes
- **Accessibility** — WCAG compliant
- **Easy rollback** — Deployment strategy for quick rollbacks
- **IndexedDB fallback** — If Supabase fails, cache data locally in IndexedDB with a stale-data banner

## Success Criteria

- [ ] User can log in via Strava OAuth
- [ ] Ride data is fetched from Strava and stored in Supabase
- [ ] Returning users only sync new rides (incremental sync)
- [ ] Virtualized leaderboard table shows all riders with sorting/filtering
- [ ] Routes are classified into the 4 main categories
- [ ] App builds and deploys successfully
- [ ] TypeScript strict mode, no type errors
- [ ] Supabase calls are typesafe from FE code

## Out of Scope (for MVP)

- Custom route editor / GPS drawing
- Social features (comments, likes, groups)
- Real-time live tracking
- Native mobile app
- Payment / premium features
- Detailed per-segment analytics

## Resolved Questions

1. **Charting library** → Recharts
2. **Route classification** → GPS gateway checkpoints (no Strava segment IDs needed)
3. **Supabase project** → Created (ref: `dgoqjrfjrzewplwayhhz`)
4. **Deployment target** → Cloudflare Pages
5. **Package manager** → pnpm
6. **Bundler** → Vite (migrated from rsbuild due to SSR compatibility)
