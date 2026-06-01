---
trigger: always_on
---

# sf2g Project Rules

## Project Context

SF2G is a **competitive cycling commute tracking web app** for the SF2G community (San Francisco → Peninsula). Riders authenticate via Strava OAuth, rides are auto-synced from the Strava API, and a virtualized leaderboard shows community-wide rankings across four route corridors.

This is a personal/community project — prioritize speed and simplicity over enterprise patterns, but keep code clean and type-safe.

### Tech Stack

| Layer       | Technology                                                     |
| ----------- | -------------------------------------------------------------- |
| Framework   | TanStack Start (full-stack React with file-based routing)      |
| Language    | TypeScript (strict mode)                                       |
| Package Mgr | pnpm                                                           |
| Bundler     | Vite                                                           |
| Database    | Supabase (PostgreSQL + REST API)                               |
| Auth        | Custom Strava OAuth 2.0 (not Supabase Auth)                    |
| Deployment  | Cloudflare Pages                                               |
| UI          | TanStack Table, TanStack Query, TanStack Virtual, Recharts     |
| Toasts      | Sonner (`sonner`)                                              |
| Styling     | Vanilla CSS with custom properties (`data-theme` dark/light)   |
| Maps        | Mapbox GL JS                                                   |

### Key Directories

| Path              | Purpose                                           |
| ----------------- | ------------------------------------------------- |
| `app/routes/`     | File-based TanStack Router routes                 |
| `app/components/` | Shared React components                           |
| `app/lib/`        | Utilities, Supabase client, classifiers, types    |
| `app/server/`     | Server functions (createServerFn)                 |
| `app/queries/`    | TanStack Query option factories                   |
| `app/styles/`     | CSS files (global.css, components.css)            |
| `supabase/`       | SQL migration files                               |

## Always Follow

- **TypeScript only** — no `.js` for source files.
- **Vanilla CSS** with custom properties — no CSS-in-JS, no Tailwind.
- **pnpm** — never use `npm` or `yarn`.
- **Named exports** over default exports.
- **`createServerFn`** from `@tanstack/react-start` for all server-side logic.
- **Supabase service client** (`createServiceClient()`) for writes — never use the anon client for mutations.
- **Environment variables**: `VITE_*` prefix for client-safe vars, no prefix for server-only secrets.
- **Never commit** `.env.local`, `.stravarc`, or service role keys.
- **Route classification** uses GPS gateway checkpoints, NOT Strava segment IDs.
- **Incremental sync** — always use `after` epoch parameter when fetching rides.

## Server Functions

All server-side logic uses TanStack Start's `createServerFn`:

```typescript
import { createServerFn } from '@tanstack/react-start'

export const myServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    // Server-only code here
  })
```

## Database Access

- **Reads**: Use anon client (`createAnonClient()`) — RLS allows public reads.
- **Writes**: Use service client (`createServiceClient()`) — bypasses RLS.
- **Types**: Auto-generated in `app/lib/database.types.ts` — run `pnpm db:types` after schema changes.

## Styling Conventions

- Use CSS custom properties defined in `app/styles/global.css`.
- Theme toggle via `data-theme="dark"` / `data-theme="light"` on `<html>`.
- Use `var(--color-*)` tokens — never hardcode colors.
- Prefer `rem` over `px` for sizing.

## File Organization

- Imports ordered: packages → lib (`../lib/`) → local (`./`).
- One component per file for route pages.
- Server functions grouped by domain in `app/server/`.
- Shared utilities in `app/lib/`.

## Toast Notifications

Use **Sonner** (`sonner`) for all toast notifications. Import from `app/components/Toast.tsx`:

```typescript
import { toast } from '../components/Toast'

// Success
toast.success('Rides synced!')

// Error with description
toast.error('Sync failed', {
  description: 'Strava API returned an error. Try again later.',
})

// Warning
toast.warning('Partial sync', {
  description: '3 rides imported, but 2 errors occurred.',
})

// Info
toast.info('Already up to date.')

// Persistent (no auto-dismiss)
toast.error('Critical error', { duration: Infinity })
```

- **No hooks or context needed** — `toast()` is a global function.
- **`<ToastProvider />`** is rendered once in `__root.tsx` — do not add it elsewhere.
- **Always use `toast` from `../components/Toast`** — never import directly from `sonner`.
- Use `toast.error()` for failures, `toast.warning()` for partial success, `toast.success()` for confirmations.
- Add `description` for longer messages that would overflow a single line.
