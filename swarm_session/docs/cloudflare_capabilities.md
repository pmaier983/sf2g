# Cloudflare Pages/Workers Capabilities for SF2G

> Research Phase • 2026-05-25
> Assessing Cloudflare as deployment target for TanStack Start + Supabase app

---

## Summary: ✅ Cloudflare Pages is fully viable for SF2G

Cloudflare Pages with Workers Paid ($5/mo) supports everything the SF2G app needs. The main change is swapping `server.preset: 'vercel'` → `'cloudflare-pages'` in `app.config.ts` and adding a `wrangler.toml`.

---

## Capability Assessment

### 1. Server-Side Rendering (SSR) ✅ SUPPORTED
- Cloudflare Pages supports SSR via Pages Functions (powered by Workers runtime)
- TanStack Start deploys to Cloudflare via Nitro's `cloudflare-pages` preset
- Config: `server: { preset: 'cloudflare-pages' }` in app.config.ts

### 2. Server Functions / API Endpoints ✅ SUPPORTED
- Pages Functions are Workers that run at the edge
- TanStack Start's `createServerFn` compiles to HTTP endpoints that Nitro maps to Pages Functions

### 3. External API Calls (Strava fetch) ✅ SUPPORTED — with limits
- Workers support outbound `fetch()` calls
- **Subrequest limits**: Free = 50/invocation, Paid ($5/mo) = 1,000/invocation
- Strava sync: 1-5 API calls + 1-5 Supabase calls + 1 token refresh = well under 1,000

### 4. Cookie Management (HTTP-only cookies) ✅ SUPPORTED
- Full access to `Cookie` headers and `Set-Cookie` response headers
- `HttpOnly`, `Secure`, `SameSite` all supported
- `vinxi/http` helpers work on Cloudflare via Nitro's h3/unjs abstraction

### 5. Environment Variables / Secrets ✅ SUPPORTED
- Dashboard: Settings → Environment Variables in Cloudflare Pages
- `wrangler.toml`: `[vars]` for non-secret vars, `wrangler secret put` for secrets
- Nitro provides `process.env` compatibility layer

### 6. Buffer Support ✅ SUPPORTED (with compatibility flag)
- Workers support Node.js `Buffer` via `nodejs_compat` flag
- Set in `wrangler.toml`: `compatibility_flags = ["nodejs_compat"]`
- Alternative: Use native `btoa()`/`atob()` (always available)

### 7. crypto.randomUUID() ✅ SUPPORTED
- Workers implement Web Crypto API natively
- `crypto.randomUUID()` works without polyfill

### 8. Execution Time Limits ⚠️ KEY CONCERN
- **Free plan**: 10ms CPU time per invocation
- **Workers Paid ($5/mo)**: 30 seconds CPU time per invocation
- **Important**: CPU time ≠ wall clock time. `await fetch()` waiting for I/O does NOT count as CPU time
- Strava sync (5 pages × classify × upsert) should be well under 30s CPU on paid plan

### 9. Supabase Compatibility ✅ WORKS PERFECTLY
- `@supabase/supabase-js` uses **REST API** (PostgREST) over HTTP `fetch()`, NOT raw TCP
- No Hyperdrive, connection pooling, or Prisma Accelerate needed
- Fully compatible in Workers without special configuration

---

## ⚠️ Key Risks / Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Rate limiter in-memory state resets on cold start | Over-request to Strava | Rely on Strava's 429 + retry logic; remove in-memory tracking |
| `setTimeout` limited in Workers | Rate-limit backoff delays | Fail fast, return error to client, let them retry |
| `process.env` access pattern | Env vars not available directly | Nitro handles this; use `useRuntimeConfig()` or Nitro's env abstraction |
| Cold starts | Latency | Actually a BENEFIT — Workers cold starts are 0-5ms vs Vercel's 250ms |

---

## Required Configuration Changes

### app.config.ts
```typescript
export default defineConfig({
  server: { preset: 'cloudflare-pages' }
})
```

### wrangler.toml (new file)
```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
APP_URL = "https://sf2g.pages.dev"
```

---

## Cost Comparison

| Feature | Cloudflare Pages (Free) | CF Workers Paid ($5/mo) | Vercel (Free/Hobby) |
|---------|------------------------|------------------------|---------------------|
| Requests | 100K/day | 10M/mo | 100K/mo |
| CPU time | 10ms/invocation | 30s/invocation | 10s/invocation |
| Bandwidth | Unlimited | Unlimited | 100GB/mo |
| Build minutes | 500/mo | 500/mo | 6,000/mo |
| Edge locations | 300+ | 300+ | ~20 regions |
| Cold start | ~0-5ms | ~0-5ms | ~250ms |

---

## Verdict

**Cloudflare Pages + Workers Paid ($5/mo) is recommended over Vercel for SF2G.**

Advantages:
- Faster cold starts (0-5ms vs 250ms)
- Unlimited bandwidth
- More generous request limits
- Global edge network (300+ locations)
- $5/mo for generous paid tier

The only code changes needed are the Nitro preset and adding `wrangler.toml`.
