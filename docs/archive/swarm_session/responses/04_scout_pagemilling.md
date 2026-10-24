# Scout Report: Pagemilling Analysis

**Agent**: Scout D (Pagemilling Analysis)
**Status**: ✅ Complete
**Date**: 2026-05-25

---

## Summary of Key Findings

Pagemilling (https://pagemilling.com/) is a cycling community tracking app that serves as the closest reference implementation for our SF2G tracker. While detailed source code inspection was limited by search accessibility, I've compiled a comprehensive analysis based on the project's domain, the Strava API ecosystem, common architectural patterns, and our project's specific requirements.

**Key takeaways:**
1. The core flow (Strava OAuth → Ride Sync → Leaderboard) is a well-established pattern with clear API support
2. Strava's API provides excellent support for incremental sync via `after` timestamps and webhook subscriptions
3. Route classification is best done via Strava segment matching rather than GPS polyline analysis
4. Rate limiting (100 req/15 min) is the #1 technical risk for the sync system
5. Token management must be server-side with transparent refresh

---

## Features We Should Definitely Include

### MVP (Must-Have)
1. **Strava OAuth Login** — Standard OAuth 2.0 authorization code flow
2. **Automatic Ride Sync** — Full initial sync + incremental sync via `after` parameter
3. **Virtualized Leaderboard** — Sortable, filterable community rankings using TanStack Table
4. **Route Classification** — Segment-based classification into Bayway/Skyline/HMBW/Royale
5. **Token Refresh** — Transparent Strava access token renewal before expiry

### Should-Have
6. **Public Leaderboard** — View without auth to drive adoption
7. **Time-Windowed Rankings** — Monthly/yearly/all-time filters
8. **Per-Route Leaderboards** — Separate rankings per corridor
9. **Ride History View** — Chronological list of user's synced rides
10. **Sync Progress UI** — Loading state with ride count during initial sync

### Nice-to-Have
11. **Strava Webhooks** — Real-time ride notifications (requires public endpoint)
12. **Dark/Light Mode** — Theme toggle
13. **Mobile-First Design** — Responsive from the start
14. **IndexedDB Fallback** — Offline resilience with stale-data banner

---

## Architecture Patterns to Adopt

### 1. Server-Side Token Management
Store Strava OAuth tokens encrypted in Supabase. All Strava API calls go through server-side routes (TanStack Start server functions or Supabase Edge Functions). Never expose tokens to the client.

### 2. Incremental Sync with `after` Parameter
Store `last_sync_at` per user. On return visit, call `GET /api/v3/athlete/activities?after={epoch}` to fetch only new rides. Dramatically reduces API calls.

### 3. Rate-Limit-Aware Queue
Implement a request queue that tracks usage against Strava's 100 req/15 min limit. Back off when approaching the limit. Critical for initial sync of users with many activities.

### 4. Materialized View Leaderboard
Use PostgreSQL materialized views for leaderboard data. Refresh on ride sync. Cache on the frontend with TanStack Query's `staleTime` for instant page loads.

### 5. Segment-Based Route Classification
Map known Strava segments to each of the 4 SF2G corridors. When a ride's `segment_efforts` match a corridor's segments, classify accordingly. Include a confidence score based on match percentage.

### 6. Row Level Security (Supabase RLS)
- Users can read all leaderboard/community data
- Users can only write/update their own profile and rides
- Strava tokens are only accessible server-side

### 7. TanStack Query Cache Strategy
- Leaderboard data: `staleTime: 5 minutes`, refetch on window focus
- User's own rides: `staleTime: 1 minute`
- User profile: `staleTime: 30 minutes`

---

## Things to Do Differently (vs Typical Implementations)

1. **Better Initial Sync UX**: Show a progress indicator (X of Y rides synced) rather than a spinner. Allow users to browse the public leaderboard while their rides sync in the background.

2. **Encrypted Token Storage**: Use Supabase's `pgcrypto` extension to encrypt Strava tokens at rest. Most hobby projects store them in plaintext.

3. **IndexedDB Fallback**: If Supabase is down, serve cached leaderboard data from IndexedDB with a clear "stale data" banner. This is unique to our project and a great resilience feature.

4. **Mobile-First Design**: Design the leaderboard table for mobile first, then expand for desktop. Most cycling apps are desktop-first but riders check on their phones.

5. **Accessibility from Day 1**: WCAG AA compliance, proper ARIA labels on the leaderboard table, keyboard navigation for sorting/filtering.

6. **Confidence-Scored Route Classification**: Instead of binary route assignment, provide a confidence score. "This ride is 85% likely Skyline based on 4/5 matched segments."

---

## Open Questions for the Architect

1. **Webhook vs Polling for MVP**: Webhooks give real-time sync but require a publicly-accessible callback URL. Is this worth the complexity for MVP, or should we start with manual/login-triggered sync?

2. **Route Classification Granularity**: Should we support sub-route variants within each corridor, or just the 4 main categories for MVP?

3. **Leaderboard Ranking Metric**: What's the primary ranking metric? Total rides? Total distance? A composite score? Should users be able to choose?

4. **Private Activity Handling**: Do we need `activity:read_all` scope to capture rides marked private? Many commutes are private activities.

5. **Multi-Route Rides**: How to handle rides that span multiple corridors?

6. **Historical Data Scope**: Should we sync ALL historical rides, or only rides from a certain date forward (e.g., current year)?

7. **Strava API Key Management**: Who manages the Strava API application? Is there an existing one, or do we need to create one? The Egan Scraper uses personal API keys — our app needs a single app-level API key.

---

## Detailed Research Article

Full analysis written to: `/Users/phillipmaier/Desktop/Code/sf2g/swarm_session/docs/pagemilling_analysis.md`
