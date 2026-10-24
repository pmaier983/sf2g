# Cloudflare + TanStack Start Deployment Research

> Research Phase • 2026-05-25
> TanStack Start + Nitro → Cloudflare Pages deployment specifics

---

## Key Finding: ✅ TanStack Start has official Cloudflare Pages support

TanStack Start uses Nitro as its server runtime, and Nitro has a built-in `cloudflare-pages` preset.

### Configuration Change (1 line)

```typescript
// app.config.ts
import { defineConfig } from '@tanstack/react-start/config'

export default defineConfig({
  server: {
    preset: 'cloudflare-pages',  // was 'vercel'
  },
})
```

### Required: wrangler.toml

```toml
name = "sf2g"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
APP_URL = "https://sf2g.pages.dev"
# Secrets go via: npx wrangler pages secret put SECRET_NAME
```

### Deployment Workflow

```bash
# Build for Cloudflare
pnpm build

# Preview locally (simulates CF Workers runtime)
npx wrangler pages dev .output/public

# Deploy to production
npx wrangler pages deploy .output/public
```

### GitHub Integration (CI/CD)
1. Connect GitHub repo in Cloudflare Dashboard
2. Build command: `pnpm build`
3. Build output: `.output/public`
4. Set env vars in dashboard
5. Push to `main` → auto-deploy; PRs get preview deployments

---

## Dependency Compatibility Matrix

| Component | CF Compatible? | Notes |
|-----------|---------------|-------|
| TanStack Start SSR | ✅ | `cloudflare-pages` Nitro preset |
| Server Functions (createServerFn) | ✅ | Run as Workers functions |
| `@supabase/supabase-js` | ✅ | Uses fetch(), edge-compatible |
| `@mapbox/polyline` | ✅ | Pure JS, zero Node deps |
| `fetch()` to Strava API | ✅ | Native global API in Workers |
| `Buffer` (session.ts) | ✅ | With `nodejs_compat` flag |
| `crypto.randomUUID()` | ✅ | Native Web Crypto API |
| Recharts (client-side) | ✅ | Browser only |
| TanStack Table/Virtual | ✅ | Client-side only |
| `vinxi/http` cookies | ✅ | H3 handles platform-agnostically |

---

## Workers Runtime Constraints

| Constraint | Free Plan | Paid ($5/mo) |
|-----------|-----------|-------------|
| CPU time | 10ms/invocation | 30s/invocation |
| Wall clock | 30s | 30s (soft) |
| Memory | 128 MB | 128 MB |
| Subrequests (fetch) | 50/invocation | 1,000/invocation |
| Request size | 100 MB | 100 MB |

**Important**: CPU time ≠ wall clock. While `await fetch()` waits for Strava/Supabase, CPU time is NOT consumed.

---

## ⚠️ Stateless Rate Limiter

Workers are stateless — in-memory `RateLimitState` resets between requests. Options:
1. **Rely on Strava's 429 responses** + retry logic (recommended for MVP)
2. Use Cloudflare KV for persistent rate limit state (future enhancement)
3. Use Durable Objects for more complex coordination (overkill for MVP)

---

## Required Code Changes for Vercel → Cloudflare Migration

1. `app.config.ts`: `preset: 'vercel'` → `preset: 'cloudflare-pages'`
2. Add `wrangler.toml` with `nodejs_compat` flag
3. Add `wrangler` to devDependencies
4. Update deploy scripts in `package.json`
5. Remove `vercel.json`
6. Simplify rate limiter to be stateless (rely on 429 + retry)
