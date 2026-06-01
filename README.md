# SF2G — San Francisco Commute Tracker

A competitive cycling commute tracker for the [SF2G](https://sf2g.com/) community. Connect your Strava account, sync your rides, and see how you stack up across four iconic Bay Area corridors.

## Features

- 🔐 **Strava OAuth** — One-click login via Strava
- 🔄 **Auto-Sync** — Fetches all rides for new users, incremental sync for returning users
- 🏆 **Leaderboard** — Virtualized table ranking riders by total commutes
- 🗺️ **Route Classification** — GPS gateway-based classification into 4 corridors:
  - **Bayway** — Bay Trail along the eastern shoreline
  - **Skyline** — Skyline Blvd through the hills
  - **HMBW** — Coastal Highway 1 route
  - **Royale** — El Camino Real boulevard route
- 🌙 **Dark/Light Mode** — Theme toggle with system preference detection
- 📱 **Responsive** — Mobile-first design

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [TanStack Start](https://tanstack.com/start/latest) |
| UI | React 19, [TanStack Table](https://tanstack.com/table/latest), [TanStack Virtual](https://tanstack.com/virtual/latest) |
| Data | [TanStack Query](https://tanstack.com/query/latest) |
| Backend | [Supabase](https://supabase.com/) (PostgreSQL + REST) |
| Auth | Strava OAuth 2.0 |
| Charts | [Recharts](https://recharts.org/) |
| Styling | Vanilla CSS (custom properties, glassmorphism) |
| Bundler | [Vite](https://vite.dev/) |
| Deploy | [Cloudflare Pages](https://pages.cloudflare.com/) |
| Package Manager | [pnpm](https://pnpm.io/) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/installation) (v9+)
- A [Strava API application](https://www.strava.com/settings/api)
- A [Supabase](https://supabase.com/) project

### Setup

```bash
# Clone and install
git clone https://github.com/pmaier983/sf2g.git
cd sf2g
pnpm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase and Strava credentials

# Run database migrations
# (Apply supabase/migrations/*.sql via Supabase Dashboard or CLI)

# Start dev server
pnpm dev
```

### Scripts

| Command | Description |
|---------|------------|
| `pnpm dev` | Start Vite dev server (localhost:5173) |
| `pnpm build` | Production build for Cloudflare |
| `pnpm preview` | Preview production build locally |
| `pnpm deploy` | Build and deploy to Cloudflare Pages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm db:types` | Regenerate Supabase types |

## Project Structure

```
app/
├── routes/           # File-based routing
│   ├── __root.tsx    # Root layout (navbar, theme)
│   ├── index.tsx     # Landing page
│   ├── leaderboard.tsx
│   ├── routes.tsx    # Route corridor documentation
│   ├── auth/         # OAuth login & callback
│   └── profile/      # Rider profiles
├── components/       # Shared components
├── lib/              # Supabase client, types, utilities
├── queries/          # TanStack Query option factories
├── server/           # Server-side logic (auth, sync, classification)
└── styles/           # CSS files
```

## Route Classification

Routes are classified using **GPS gateway checkpoints** — specific lat/lng coordinates that a ride must pass through. This avoids dependency on Strava segment IDs.

| Route | Gateway Coordinates |
|-------|-------------------|
| Bayway | (37.684, -122.390) → (37.579, -122.311) |
| Skyline | (37.668, -122.485) → (37.484, -122.316) |
| HMBW | (37.449, -122.429) → (37.578, -122.512) |
| Royale | (37.625, -122.414) → (37.521, -122.277) |

**Start point**: Peet's Coffee, PPR (37.773, -122.439)
**Intercept**: JD/Skyline (37.698, -122.495)

## Reference

- [Implementation Plan](swarm_session/docs/implementation_plan.md) — Detailed task breakdown
- [System Architecture](swarm_session/docs/system_architecture.md) — Full system design
- [Egan Scraper](Egan%20Scraper.md) — Historical context on Strava segment scraping
- [SF2G Website](https://sf2g.com/) — Official community site
- [Strava API Docs](https://developers.strava.com/docs/reference/)

## License

Private — not yet licensed for public use.
