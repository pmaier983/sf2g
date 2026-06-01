# SF2G Architecture & Patterns

SF2G is a full-stack TanStack Start application that tracks cycling commutes from San Francisco to the Peninsula.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Cloudflare Pages                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │              TanStack Start (Vite)                 │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │  Routes  │  │Components│  │  Server Functions │ │  │
│  │  │(file-    │  │(React)   │  │ (createServerFn)  │ │  │
│  │  │ based)   │  │          │  │                   │ │  │
│  │  └──────────┘  └──────────┘  └────────┬──────────┘ │  │
│  └───────────────────────────────────────┼────────────┘  │
└──────────────────────────────────────────┼───────────────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     │                     │                     │
              ┌──────▼──────┐       ┌──────▼──────┐      ┌──────▼──────┐
              │  Supabase   │       │  Strava API │      │   Mapbox    │
              │ (PostgreSQL)│       │  (OAuth +   │      │  (GL JS)   │
              │             │       │   REST)     │      │            │
              └─────────────┘       └─────────────┘      └────────────┘
```

---

## Route Structure

File-based routing via TanStack Router:

| Route                     | File                         | Purpose                              |
| ------------------------- | ---------------------------- | ------------------------------------ |
| `/`                       | `routes/index.tsx`           | Landing / leaderboard                |
| `/leaderboard`            | `routes/leaderboard.tsx`     | Full leaderboard table               |
| `/routes`                 | `routes/routes.tsx`          | Route corridors info + map           |
| `/auth/login`             | `routes/auth/login.tsx`      | Strava OAuth redirect                |
| `/auth/callback`          | `routes/auth/callback.tsx`   | OAuth callback handler               |
| `/profile/$userId`        | `routes/profile/$userId.tsx` | Individual rider profile             |

---

## Server Functions

All server-side logic uses `createServerFn` from `@tanstack/react-start`. These are RPC-style functions that run on the server but are callable from React components.

### Domain Grouping

| File                | Functions                                              |
| ------------------- | ------------------------------------------------------ |
| `server/auth.ts`    | `getStravaAuthUrl`, `handleStravaCallback`, `getCurrentUser`, `logout` |
| `server/sync.ts`    | Strava ride syncing with incremental `after` param     |
| `server/rides.ts`   | Ride CRUD operations                                   |
| `server/users.ts`   | User queries                                           |
| `server/leaderboard.ts` | Leaderboard data queries                          |
| `server/reclassify.ts`  | Route reclassification (dev tools)                |

---

## Authentication Flow

Custom Strava OAuth 2.0 (Supabase has no built-in Strava provider):

1. User clicks "Connect with Strava" → `getStravaAuthUrl()` returns OAuth URL
2. User authorizes on Strava → redirected to `/auth/callback` with `code`
3. `handleStravaCallback()` exchanges code for tokens, upserts user in DB
4. Session cookie set via `setSessionData()` (HTTP-only, signed)
5. `getCurrentUser()` reads session cookie → returns user from DB

Tokens are stored server-side in the `users` table. Auto-refresh with buffer.

---

## Route Classification System

3-layer classification in `app/lib/route-classifier.ts`:

### Layer 0: Commute Filter
- One endpoint must be in SF, the other in the peninsula corridor
- Uses bounding boxes (`SF_BOUNDS`) and polygon test (`PENINSULA_CORRIDOR`)

### Layer 1: Gateway Classification (Primary)
- Decodes Strava summary polyline into lat/lng points
- Checks proximity to known gateway checkpoints (within 500m)
- Gateway checkpoints defined in `app/lib/constants.ts` as `ROUTE_GATEWAYS`
- Each gateway maps to a `RouteCategory`: bayway, skyline, hmbw, royale
- Confidence: 0.95 (2+ gateways), 0.80 (1 gateway), 0.70 (ambiguous)

### Layer 2: Elevation Fallback
- Uses total elevation gain + start/end coordinates
- Requires minimum 40km distance
- Lower confidence (0.3–0.5)

### Categories

| Category  | Description                          | Gateway Count |
| --------- | ------------------------------------ | ------------- |
| `bayway`  | Bay Trail along eastern shoreline    | Multiple      |
| `skyline` | Skyline Blvd through the hills       | Multiple      |
| `hmbw`    | Half Moon Bay Way (coastal Hwy 1)    | Multiple      |
| `royale`  | El Camino Real boulevard route       | Multiple      |
| `other`   | Unclassified or non-commute ride     | —             |

---

## Database Schema

Tables in Supabase PostgreSQL:

### `users`
- `id` (UUID, PK)
- `strava_id` (int8, unique)
- `username`, `first_name`, `last_name`, `display_name` (generated)
- `avatar_url`
- `strava_access_token`, `strava_refresh_token`, `strava_token_expires_at`
- `strava_scopes`

### `rides`
- `id` (UUID, PK)
- `user_id` (FK → users)
- `strava_activity_id` (int8, unique — idempotent upserts)
- `name`, `distance`, `moving_time`, `elapsed_time`, `total_elevation_gain`
- `start_date`, `start_latlng`, `end_latlng`
- `summary_polyline`
- `route_category`, `route_confidence`, `classification_method`
- `destination_company`, `destination_office`

### `route_segments`
- Segment ID → corridor mapping for reference

### Views
- `leaderboard_view` — materialized view for fast leaderboard queries
- `monthly_ride_stats` — regular view for charts

### RLS Policy
- **Reads**: Public (anon can SELECT)
- **Writes**: Denied for anon; service role for all mutations

---

## Destination Classification

`app/lib/destination-classifier.ts` classifies rides to corporate office destinations:

- Uses `app/lib/office-locations.ts` for GPS coordinates of tech company offices
- 200m proximity threshold to match ride endpoints to offices
- Companies: Google, Apple, Meta, Netflix, Nvidia (past + present locations)

---

## Sync Strategy

- **Polling only** (webhooks deferred for MVP)
- **Auto-sync on login** + manual "Sync Now" button
- **Incremental** via `after` epoch parameter (only fetch new rides)
- **Batch upsert** — idempotent via `UNIQUE(strava_activity_id)`
- **Rate limiting** via `app/lib/rate-limiter.ts`

---

## Styling System

Vanilla CSS with custom properties for theming:

```css
/* Theme tokens in global.css */
[data-theme="dark"] {
  --color-bg-primary: #1a1a2e;
  --color-text-primary: #e0e0e0;
  /* ... */
}

[data-theme="light"] {
  --color-bg-primary: #f8f9fa;
  --color-text-primary: #1a1a2e;
  /* ... */
}
```

- Theme persisted in `localStorage` as `sf2g-theme`
- Blocking `<script>` in `<head>` prevents flash on reload
- Components use `var(--color-*)` tokens exclusively

---

## Key Components

| Component             | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `LeaderboardTable`    | TanStack Table + Virtual for leaderboard         |
| `LeaderboardColumns`  | Column definitions with sorting                  |
| `InteractiveMap`      | Mapbox GL JS map with route corridors            |
| `GatewayMap`          | Smaller map showing gateway checkpoints          |
| `RideCard`            | Individual ride summary card                     |
| `RideFrequencyChart`  | Recharts-based ride frequency chart              |
| `NavBar`              | Top navigation with auth state                   |
| `ThemeToggle`         | Dark/light mode toggle                           |
| `SyncStatus`          | Sync progress indicator                          |
| `DevToolsPanel`       | Dev-only tools (reclassify routes, etc.)         |
| `RouteTag`            | Colored badge for route categories               |
| `StravaLoginButton`   | "Connect with Strava" CTA                        |
