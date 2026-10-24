# SF2G Tech Stack Research

> Scout Agent Research Article — 2026-05-25

---

## 1. TanStack Start

### Overview
TanStack Start is a full-stack React framework built on top of **TanStack Router** and powered by **Nitro** as the server runtime. It provides SSR, server functions, file-based routing, and deployment flexibility — all with first-class TypeScript support.

### Setup
```bash
npx create-start-app@latest sf2g
cd sf2g
npm install
npm run dev
```

### File-Based Routing Conventions

| Pattern | URL | File |
|---------|-----|------|
| Index route | `/` | `routes/index.tsx` |
| Static route | `/about` | `routes/about.tsx` |
| Dynamic param | `/rides/$rideId` | `routes/rides/$rideId.tsx` |
| Nested layout | `/auth/*` | `routes/auth/` directory |
| Root layout | All pages | `routes/__root.tsx` |

Each route file exports a `createFileRoute` definition:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/leaderboard')({
  component: LeaderboardPage,
  loader: async () => {
    return fetchLeaderboardData()
  },
})
```

### Server Functions (createServerFn)

Server functions are the RPC mechanism — they run only on the server but can be called from client code:

```tsx
import { createServerFn } from '@tanstack/react-start'

const fetchRides = createServerFn({ method: 'GET' })
  .validator((input: { userId: string }) => input)
  .handler(async ({ data }) => {
    const rides = await supabase
      .from('rides')
      .select('*')
      .eq('user_id', data.userId)
    return rides.data
  })
```

Key points:
- Server functions are **tree-shaken** from the client bundle
- Support `GET` (cacheable) and `POST` methods
- Input validation via `.validator()` chain
- Can be used in route loaders for SSR data fetching

### Deployment Options

TanStack Start uses **Nitro** presets. Configure in `app.config.ts`:

```ts
import { defineConfig } from '@tanstack/react-start/config'

export default defineConfig({
  server: {
    preset: 'vercel', // or 'netlify', 'cloudflare-pages', 'node-server'
  },
})
```

### Maturity Assessment

| Aspect | Status |
|--------|--------|
| TanStack Router | **Stable (v1.x)** |
| TanStack Start | **RC / Early Stable** — 1.0 in late 2025 |
| TanStack Query | **Stable (v5.x)** |
| TanStack Table | **Stable (v8.x)** |

**Assessment**: Suitable for a greenfield project like SF2G. Risk is mitigated by pinning exact versions and the ability to fall back to a Vite SPA.

---

## 2. TanStack Table

### Virtualized Table with React

Combine `@tanstack/react-table` with `@tanstack/react-virtual`:

```tsx
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'

function LeaderboardTable({ data, columns }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const { rows } = table.getRowModel()
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 20,
  })

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          return (
            <div key={row.id} style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
            }}>
              {row.getVisibleCells().map((cell) => (
                <div key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

---

## 3. TanStack Query

### Query Options Pattern (Recommended)

```tsx
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '../supabase'

export const leaderboardQueryOptions = () =>
  queryOptions({
    queryKey: ['leaderboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_leaderboard')
      if (error) throw error
      return data
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  })
```

### Optimistic Updates

```tsx
const syncRidesMutation = useMutation({
  mutationFn: async (newRides: Ride[]) => {
    const { error } = await supabase.from('rides').upsert(newRides)
    if (error) throw error
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['rides', userId] })
    queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
  },
})
```

### Cache Invalidation Strategy
```
Ride Sync Complete → invalidate ['rides', userId] + ['leaderboard']
Route Classified   → invalidate ['rides', userId]
User Login         → prefetch ['rides', userId]
```

---

## 4. Supabase

### Database Schema Design

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strava_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  strava_access_token TEXT,
  strava_refresh_token TEXT,
  strava_token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  strava_activity_id BIGINT UNIQUE NOT NULL,
  ride_date DATE NOT NULL,
  route_category TEXT CHECK (route_category IN ('bayway', 'skyline', 'hmbw', 'royale', 'other', NULL)),
  distance_meters REAL,
  moving_time_seconds INTEGER,
  elapsed_time_seconds INTEGER,
  elevation_gain_meters REAL,
  average_speed REAL,
  max_speed REAL,
  start_latlng JSONB,
  end_latlng JSONB,
  summary_polyline TEXT,
  segment_efforts JSONB,
  strava_raw JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rides_user_id ON rides(user_id);
CREATE INDEX idx_rides_ride_date ON rides(ride_date DESC);
CREATE INDEX idx_rides_route_category ON rides(route_category);

CREATE MATERIALIZED VIEW leaderboard AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  COUNT(r.id) AS total_rides,
  COUNT(r.id) FILTER (WHERE r.route_category = 'bayway') AS bayway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'skyline') AS skyline_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'hmbw') AS hmbw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'royale') AS royale_count,
  MAX(r.ride_date) AS last_ride_date
FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.avatar_url;
```

### Row Level Security (RLS)

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Public reads for community leaderboard
CREATE POLICY "Users are viewable by everyone" ON users FOR SELECT USING (true);
CREATE POLICY "Rides are viewable by everyone" ON rides FOR SELECT USING (true);

-- Owner-only writes
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own rides" ON rides FOR INSERT WITH CHECK (auth.uid() = user_id);
```

### Strava OAuth with Supabase Auth

Supabase does **not** have a built-in Strava OAuth provider. **Recommended approach**: Handle Strava OAuth manually in a server function, store tokens in users table, manage sessions via Supabase Auth or custom JWT.

### Generated TypeScript Types

```bash
npx supabase gen types typescript --linked > src/lib/database.types.ts
```

```tsx
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)
// All queries are now typesafe!
```

---

## 5. Typesafe Supabase Pattern

From the user's Blog repo pattern:
1. Generated types via `supabase gen types typescript`
2. `createClient<Database>(...)` for full type inference
3. Helper types: `Tables['rides']['Row']`, `Tables['rides']['Insert']`
4. Query options pattern integrates types with TanStack Query

**Simplified for SF2G**: Fewer tables, single schema, no ORM needed.

---

## 6. Charting Libraries

### Recommendation: **Recharts**

**Rationale**:
1. Declarative React component API
2. Perfect for ride frequency time-series
3. No CSS framework dependency
4. Largest React charting community
5. Compatible with SSR (SVG-based)

**Runner-up**: Tremor — if Tailwind CSS is adopted.

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

function RideFrequencyChart({ data }: { data: MonthlyRideCount[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="bayway" stroke="#3B82F6" />
        <Line type="monotone" dataKey="skyline" stroke="#10B981" />
        <Line type="monotone" dataKey="hmbw" stroke="#F59E0B" />
        <Line type="monotone" dataKey="royale" stroke="#EF4444" />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

---

## Summary of Technology Decisions

| Technology | Version | Role | Confidence |
|-----------|---------|------|------------|
| TanStack Start | 1.x | Full-stack framework | ⚠️ Medium-High |
| TanStack Router | 1.x | File-based routing | ✅ High |
| TanStack Query | 5.x | Data fetching/caching | ✅ High |
| TanStack Table | 8.x | Virtualized leaderboard | ✅ High |
| TanStack Virtual | 3.x | Row virtualization | ✅ High |
| Supabase | Latest | Backend-as-a-service | ✅ High |
| Recharts | 2.x | Charts/graphs | ✅ High |
| TypeScript | 5.x | Type safety | ✅ High |
