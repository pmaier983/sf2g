# SF2G — San Francisco Commute Tracker

## Project Overview

SF2G is a competitive cycling commute tracking web app for the SF2G community. Riders log in via Strava OAuth, their ride history is auto-synced, and a leaderboard shows community-wide rankings across four route corridors (Bayway, Skyline, HMBW, Royale).

- **Production URL**: [sf2ging.com](https://sf2ging.com)

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start/latest) (full-stack React)
- **Language**: TypeScript (strict mode)
- **Package Manager**: pnpm
- **Bundler**: Vite (with `@tanstack/react-start/plugin/vite`)
- **Backend**: [Supabase](https://supabase.com/) (PostgreSQL + REST API)
- **Auth**: Strava OAuth 2.0 (custom flow, not Supabase Auth)
- **Deployment**: Cloudflare Pages
- **UI Libraries**: TanStack Table, TanStack Query, TanStack Virtual, Recharts
- **Tooltips**: Floating UI (`@floating-ui/react`) — use `<Tooltip>` component from `app/components/Tooltip.tsx`
- **Toasts**: Sonner (`sonner`) — dismissable toast notifications
- **Styling**: Vanilla CSS with custom properties (dark/light mode)

## Project Structure

```
sf2g/
├── app/
│   ├── client.tsx              # Client entry (hydration)
│   ├── router.tsx              # TanStack Router config
│   ├── ssr.tsx                 # SSR server entry
│   ├── routeTree.gen.ts        # Auto-generated route tree
│   ├── components/             # Shared React components
│   ├── lib/                    # Utilities, Supabase client, types
│   ├── queries/                # TanStack Query option factories
│   ├── routes/                 # File-based routes
│   │   ├── __root.tsx          # Root layout (navbar, theme, styles)
│   │   ├── index.tsx           # Landing page (/)
│   │   ├── leaderboard.tsx     # Full leaderboard (/leaderboard)
│   │   ├── routes.tsx          # Route corridors info (/routes)
│   │   ├── auth/login.tsx      # Strava OAuth redirect
│   │   ├── auth/callback.tsx   # OAuth callback handler
│   │   └── profile/$userId.tsx # Rider profile page
│   ├── server/                 # Server-side logic (API routes, sync)
│   └── styles/                 # CSS files (global.css, components.css)
├── supabase/
│   └── migrations/             # SQL migration files
├── public/                     # Static assets
├── vite.config.ts              # Vite + TanStack Start plugin config
├── tsconfig.json               # TypeScript configuration
├── wrangler.toml               # Cloudflare Pages config
├── package.json                # Dependencies and scripts
└── pnpm-lock.yaml              # Lockfile
```

## Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start Vite dev server (localhost:5173)
pnpm build            # Production build
pnpm typecheck        # Run TypeScript type checking
pnpm db:types         # Regenerate Supabase types
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-only)
- `STRAVA_CLIENT_ID` — Strava API app client ID
- `STRAVA_CLIENT_SECRET` — Strava API app client secret
- `SESSION_SECRET` — Secret for signing session cookies
- `VITE_APP_URL` — Public app URL (e.g. `http://localhost:5173`)

## Key Design Decisions

- **Route Classification**: GPS gateway checkpoints, NOT Strava segment IDs. Rides are classified based on proximity to specific lat/lng coordinates.
- **Auth**: Custom Strava OAuth flow (Supabase has no built-in Strava provider). Tokens stored server-side.
- **Sync Strategy**: Polling-based incremental sync (webhooks deferred for MVP).
- **Secrets**: Never commit `.env.local`, `.stravarc`, or service role keys.
- **Tooltips**: Always use the Floating UI `<Tooltip>` component (`app/components/Tooltip.tsx`) instead of native HTML `title` attributes. Floating UI provides better positioning, styling, and accessibility.

## Reference Documentation

- [Implementation Plan](swarm_session/docs/implementation_plan.md)
- [System Architecture](swarm_session/docs/system_architecture.md)
- [Egan Scraper](Egan%20Scraper.md) — Historical context on Strava scraping
