# SF2G — San Francisco Commute Tracker

A competitive cycling commute tracker for the [SF2G](https://sf2g.com/) community. Connect your Strava account, sync your rides, and see how you stack up across seven Bay Area corridors.

**Live at [sf2ging.com](https://sf2ging.com)**

## Features

- 🔐 **Strava OAuth** — One-click login via Strava
- 🔄 **Auto-Sync** — Full history fetch for new users, incremental sync for returning riders
- 🏆 **Leaderboard** — Virtualized table ranking riders by total commutes, with expandable ride details
- 🗺️ **Route Classification** — GPS gateway-based classification into 7 corridors:
  - **Bayway** — Bay Trail along the eastern shoreline
  - **Skyline** — Skyline Blvd through the hills
  - **HMBW** — Coastal Highway 1 through Devil's Slide
  - **Royale** — El Camino Real boulevard route
  - **Fleaway** — Flat El Camino / Bayshore blend
  - **MEBW** — Middle East Bay Way through Castro Valley
  - **FEBW** — Far East Bay Way through Berkeley Hills and Dublin
- 🌬️ **Wind Data** — Tailwind/headwind indicators enriched from weather APIs
- 🗺️ **Interactive Maps** — Leaflet-powered route visualization with gateway markers
- 📊 **Rider Profiles** — Per-rider stats, ride history table, frequency charts, and route breakdowns
- 📈 **Community Charts** — Route distribution pie charts and growth trends
- 🔍 **Leaderboard Filters** — Filter by route, time period, and rider with chip-based UI
- 🌙 **Dark/Light Mode** — Theme toggle with system preference detection
- 📐 **Unit Toggle** — Switch between metric and imperial
- 📱 **Responsive** — Mobile-first design
- 📊 **Analytics** — PostHog integration for usage tracking

## Tech Stack

| Layer           | Technology                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Framework       | [TanStack Start](https://tanstack.com/start/latest) (full-stack React)                                                 |
| UI              | React 19, [TanStack Table](https://tanstack.com/table/latest), [TanStack Virtual](https://tanstack.com/virtual/latest) |
| Data            | [TanStack Query](https://tanstack.com/query/latest)                                                                    |
| Backend         | [Supabase](https://supabase.com/) (PostgreSQL + REST)                                                                  |
| Auth            | Strava OAuth 2.0                                                                                                       |
| Charts          | [Recharts](https://recharts.org/)                                                                                      |
| Maps            | [Leaflet](https://leafletjs.com/)                                                                                      |
| Analytics       | [PostHog](https://posthog.com/)                                                                                        |
| Styling         | Vanilla CSS (custom properties, glassmorphism)                                                                         |
| Testing         | [Vitest](https://vitest.dev/)                                                                                          |
| Bundler         | [Vite](https://vite.dev/)                                                                                              |
| Deploy          | [Cloudflare Workers](https://developers.cloudflare.com/workers/) (Free plan)                                           |
| Package Manager | [pnpm](https://pnpm.io/)                                                                                               |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+) and [pnpm](https://pnpm.io/installation) (v12, pinned via `packageManager`)
- Docker (Docker Desktop, or `brew install colima docker && colima start`)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- A [Strava API application](https://www.strava.com/settings/api) with `localhost` in its Authorization Callback Domain (only needed to log in locally)

### Setup

```bash
git clone https://github.com/pmaier983/sf2g.git
cd sf2g
pnpm install

# Local database (never point local dev at production)
pnpm db:start        # starts Postgres + PostgREST in Docker
pnpm db:reset        # applies supabase/migrations/* and supabase/seed/*

cp .env.example .env.local   # local Supabase defaults are pre-filled
pnpm dev                     # http://localhost:5173
```

### Scripts

| Command                     | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev`                  | Start Vite dev server (localhost:5173)                                               |
| `pnpm build`                | Production build for Cloudflare                                                      |
| `pnpm preview`              | Preview production build locally                                                     |
| `pnpm deploy`               | Build and deploy to Cloudflare Workers                                               |
| `pnpm typecheck`            | Run TypeScript type checking                                                         |
| `pnpm test`                 | Run tests once                                                                       |
| `pnpm test:watch`           | Run tests in watch mode                                                              |
| `pnpm test:db`              | DB tests against the local fixture DB (resets it when migrations or fixtures differ) |
| `pnpm e2e`                  | Playwright smoke tests (reuses a running `pnpm dev`)                                 |
| `pnpm db:start` / `db:stop` | Start / stop the local Supabase stack                                                |
| `pnpm db:reset`             | Re-apply all migrations and seed data locally                                        |
| `pnpm db:types`             | Regenerate `app/lib/database.types.ts` from the local DB                             |

## Project Structure

```
app/
├── routes/              # File-based routing
│   ├── __root.tsx       # Root layout (navbar, theme, toasts)
│   ├── index.tsx        # Landing page
│   ├── leaderboard.tsx  # Full leaderboard with filters
│   ├── routes.tsx       # Route corridor documentation
│   ├── auth/            # OAuth login & callback
│   └── profile/         # Rider profiles ($userId)
├── components/          # Shared components
│   ├── LeaderboardTable.tsx      # Virtualized leaderboard
│   ├── LeaderboardColumns.tsx    # Column definitions & sub-tables
│   ├── LeaderboardFilters.tsx    # Route/time filter chips
│   ├── InteractiveMap.tsx        # Leaflet route map
│   ├── GatewayMap.tsx            # Gateway checkpoint map
│   ├── ProfileRideStats.tsx      # Rider stat cards
│   ├── ProfileRidesTable.tsx     # Per-rider ride history
│   ├── CommunityPieCharts.tsx    # Route distribution charts
│   ├── GrowthChart.tsx           # Cumulative ride growth
│   ├── RideFrequencyChart.tsx    # Ride frequency over time
│   ├── RouteSpeedTable.tsx       # Speed stats by route
│   ├── WindIndicator.tsx         # Tailwind/headwind display
│   ├── FilterChips.tsx           # Chip-based filter UI
│   ├── UnitToggle.tsx            # Metric/imperial toggle
│   ├── ThemeToggle.tsx           # Dark/light mode toggle
│   ├── NavBar.tsx                # Navigation bar
│   ├── Toast.tsx                 # Sonner toast wrapper
│   └── DevToolsPanel.tsx         # Admin/dev tools panel
├── lib/                 # Utilities, types, classifiers
│   ├── route-classifier.ts       # GPS gateway route classification
│   ├── destination-classifier.ts # Office/destination detection
│   ├── office-locations.ts       # Known office coordinates
│   ├── constants.ts              # Gateways, colors, labels
│   ├── database.types.ts         # Auto-generated Supabase types
│   ├── session.ts                # Cookie session management
│   ├── strava-oauth.ts           # Strava OAuth flow
│   ├── strava.ts                 # Strava API helpers
│   ├── wind.ts                   # Wind calculation utilities
│   ├── rate-limiter.ts           # API rate limiting
│   ├── analytics.ts              # PostHog analytics
│   ├── supabase.ts               # Supabase client factory
│   └── useUnit.ts                # Unit preference hook
├── queries/             # TanStack Query option factories
│   ├── leaderboard.ts
│   ├── rides.ts
│   └── user.ts
├── server/              # Server-side logic (createServerFn)
│   ├── auth.ts                   # OAuth login/logout/callback
│   ├── sync.ts                   # Strava ride sync
│   ├── leaderboard.ts            # Leaderboard queries
│   ├── rides.ts                  # Ride CRUD operations
│   ├── reclassify.ts             # Bulk route reclassification
│   ├── wind-enrichment.ts        # Wind data enrichment
│   ├── weather.ts                # Weather API integration
│   ├── cron.ts                   # Maintenance + admin "run one tick"
│   ├── sync-drain.ts             # Sync job queue drain (Cron Trigger)
│   └── users.ts                  # User management
└── styles/              # CSS files
    ├── global.css                # Theme variables, base styles
    ├── components.css            # Component-specific styles
    ├── leaderboard.css           # Leaderboard-specific styles
    ├── maps.css                  # Map component styles
    ├── routes.css                # Routes page styles
    └── wind.css                  # Wind indicator styles
```

## Route Classification

Routes are classified using **GPS gateway checkpoints** — specific lat/lng coordinates that a ride's decoded polyline must pass through. This avoids dependency on Strava segment IDs and works reliably across different GPS devices.

| Route   | Description                   | Gateway North      | Gateway South      |
| ------- | ----------------------------- | ------------------ | ------------------ |
| Bayway  | Bay shore / Foster City       | (37.684, -122.390) | (37.579, -122.311) |
| Skyline | Mountain ridge / Skyline Blvd | (37.668, -122.485) | (37.489, -122.320) |
| HMBW    | Coastal / Devil's Slide       | (37.578, -122.512) | (37.449, -122.429) |
| Royale  | El Camino Real corridor       | (37.611, -122.403) | (37.521, -122.277) |
| Fleaway | Flat El Camino / Bayshore     | (37.624, -122.408) | (37.492, -122.266) |
| MEBW    | Middle East Bay               | (37.683, -122.178) | (37.509, -122.114) |
| FEBW    | Far East Bay                  | (37.814, -122.144) | (37.669, -122.001) |

**Start point**: Peet's Coffee, PPR (37.773, -122.439)
**Intercept**: JD/Skyline (37.698, -122.495)
**Gateway radius**: 500 meters

## How it works

```
Browser ──► Cloudflare Worker (TanStack Start, Free plan: 10 ms CPU, 50 subrequests)
              │  every page = one SQL function call (get_leaderboard, get_rides, …)
              ▼
            Supabase Postgres ◄── sync_jobs queue ◄── Strava webhook (records only)
              ▲                        │
              └── Cron Trigger */5 ────┘  drains the queue in budget-sized steps
```

- **Reads**: aggregation happens in Postgres (migrations 037–040); the
  Worker never loads rides to aggregate them. Table state lives in the URL
  (`app/lib/table-query.ts`) and every table renders through
  `app/components/table/DataTable.tsx`.
- **Sync**: the webhook enqueues; a Cloudflare Cron Trigger (`wrangler.jsonc`)
  drains `sync_jobs` every 5 minutes; a 12-hour sweep catches anything a
  webhook missed. See [docs/ops/sync.md](docs/ops/sync.md).
- **Dates**: calendar dates are America/Los_Angeles (`app/lib/dates.ts`).

## Environment Variables

Copy `.env.example` to `.env.local` (local values) — production values are
Cloudflare secrets/vars.

| Variable                                                                   | Description                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`                                        | Supabase project (local: `pnpm db:start`)             |
| `SUPABASE_SERVICE_ROLE_KEY`                                                | Server only — sync, queue, admin                      |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`                                 | Strava API app                                        |
| `STRAVA_WEBHOOK_VERIFY_TOKEN`                                              | Echoed back when Strava verifies the webhook          |
| `STRAVA_WEBHOOK_SUBSCRIPTION_ID`                                           | Optional — ignore events for other subscriptions      |
| `SESSION_SECRET`                                                           | ≥ 32 chars, signs session cookies                     |
| `ADMIN_USER_IDS`                                                           | Comma-separated user ids allowed to use admin actions |
| `CRON_SECRET`                                                              | Bearer token for `POST /api/cron`                     |
| `APP_URL`                                                                  | Public app URL                                        |
| `VITE_MAP_TILE_URL`, `VITE_MAP_TILE_URL_DARK`, `VITE_MAP_TILE_ATTRIBUTION` | Optional map tile provider (default: OpenStreetMap)   |

## Docs

- [Operations runbooks](docs/ops/README.md) — deploys, migrations, secrets, sync, logs
- [Rework plan](docs/rework/README.md) — why the app is built the way it is
- [Strava API Docs](https://developers.strava.com/docs/reference/)
- [SF2G Website](https://sf2g.com/)

## License

Private — not yet licensed for public use.
