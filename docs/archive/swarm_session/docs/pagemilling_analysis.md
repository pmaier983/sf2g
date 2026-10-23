# Pagemilling Analysis — Reference Implementation for SF2G Tracker

## 1. Overview

**Pagemilling** (https://pagemilling.com/, https://github.com/maugt/pagemilling) is a cycling community project that tracks commute rides with leaderboards — the same core concept as our SF2G tracker. Named after Page Mill Road, a popular cycling climb in the Palo Alto/Los Altos area on the San Francisco Peninsula, the project serves as the closest existing reference implementation for what we're building.

This analysis covers what we could determine about the site's features, technical architecture, and patterns — plus actionable recommendations for our SF2G build.

---

## 2. Live Site Analysis (https://pagemilling.com/)

### 2.1 Core Features (Inferred)

Based on project references and the domain context:

| Feature | Description | Confidence |
|---------|------------|------------|
| **Strava OAuth Login** | Users authenticate via Strava to connect their account | High |
| **Ride Sync** | Rides are fetched from Strava API after authentication | High |
| **Leaderboard** | Community-wide rankings of riders by ride metrics | High |
| **Ride Categorization** | Rides classified by route/segment type | Medium |
| **Community Dashboard** | Overview of community riding statistics | Medium |
| **Rider Profiles** | Individual rider stats and ride history | Medium |

### 2.2 UI Structure (Inferred)

Typical cycling community apps follow this pattern:

1. **Landing Page** — Hero section with community branding, "Connect with Strava" CTA button
2. **Leaderboard View** — Main table showing ranked riders with sortable columns (total rides, total distance, average speed, etc.)
3. **Ride History** — Individual ride listing with route details
4. **Profile/Settings** — User account management

### 2.3 Leaderboard Design Patterns

Common leaderboard patterns in cycling community apps:
- **Sortable columns**: Total rides, total distance, average speed, elevation gain
- **Time filters**: All-time, this year, this month, this week
- **Route filters**: Filter by specific route/corridor
- **Rank badges**: Visual indicators for top performers
- **Pagination or virtualization**: For handling large rider pools

### 2.4 Ride Display/Categorization

- Rides typically displayed chronologically with route classification tags
- Color-coded by route type (analogous to our Bayway/Skyline/HMBW/Royale)
- Key metrics shown per ride: date, distance, time, average speed, elevation

### 2.5 New User UX Flow

Standard flow for Strava-integrated cycling apps:
1. Visit site → See public leaderboard (read-only)
2. Click "Connect with Strava" → OAuth redirect to Strava
3. Authorize app → Redirect back with auth code
4. Initial sync → Fetch all historical rides (loading state with progress)
5. Land on leaderboard → User now appears in rankings

### 2.6 Visual Design

- **Dark/Light Mode**: Unknown for Pagemilling specifically; modern cycling apps increasingly support both
- **Mobile Responsive**: Expected for modern web apps; cycling community members often check on mobile

---

## 3. Source Code Analysis (https://github.com/maugt/pagemilling)

### 3.1 Tech Stack (Inferred from Context)

Based on the repository reference and domain patterns:

| Layer | Likely Technology | Rationale |
|-------|------------------|-----------|
| **Frontend** | React or Next.js | Most common for modern Strava-integrated apps |
| **Backend** | Node.js/Express or serverless functions | Standard for Strava API integration |
| **Database** | Firebase/Firestore or PostgreSQL | Common BaaS choices for community apps |
| **Auth** | Strava OAuth 2.0 | Required for ride data access |
| **Hosting** | Vercel or Firebase Hosting | Common deployment targets |
| **Language** | JavaScript/TypeScript | Standard for web apps |

### 3.2 Authentication Pattern

Based on Strava API documentation (https://developers.strava.com/docs/authentication/):

**OAuth 2.0 Authorization Code Flow:**
1. **Redirect to Strava**: `GET https://www.strava.com/oauth/authorize?client_id={ID}&redirect_uri={URI}&response_type=code&scope=activity:read`
2. **Exchange code for tokens**: `POST https://www.strava.com/oauth/token` with `grant_type=authorization_code`
3. **Store tokens**: Save `access_token` (short-lived, ~6 hours), `refresh_token` (long-lived), and `expires_at`
4. **Token refresh**: When `access_token` expires, use `refresh_token` to get new tokens via `POST /oauth/token` with `grant_type=refresh_token`

**Key Implementation Details:**
- Required scope: `activity:read` (for reading public and private activities)
- Tokens must be stored server-side for security
- Client secret must never be exposed to the frontend
- Token refresh should happen transparently before API calls

### 3.3 Data Model (Recommended Schema)

Based on Strava API entities and leaderboard requirements:

```sql
-- Users table (linked to Strava athletes)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strava_athlete_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  profile_picture_url TEXT,
  strava_access_token TEXT, -- encrypted
  strava_refresh_token TEXT, -- encrypted
  strava_token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rides/Activities table
CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strava_activity_id BIGINT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  distance_meters FLOAT,
  moving_time_seconds INTEGER,
  elapsed_time_seconds INTEGER,
  total_elevation_gain_meters FLOAT,
  start_date TIMESTAMPTZ,
  start_latlng POINT,
  end_latlng POINT,
  average_speed FLOAT,
  max_speed FLOAT,
  route_category TEXT, -- 'bayway', 'skyline', 'hmbw', 'royale', 'other'
  commute BOOLEAN DEFAULT FALSE,
  summary_polyline TEXT, -- encoded polyline for route display
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leaderboard materialized view (for performance)
CREATE MATERIALIZED VIEW leaderboard AS
SELECT 
  u.id as user_id,
  u.username,
  u.first_name,
  u.last_name,
  u.profile_picture_url,
  COUNT(r.id) as total_rides,
  SUM(r.distance_meters) as total_distance,
  AVG(r.average_speed) as avg_speed,
  SUM(r.total_elevation_gain_meters) as total_elevation,
  MAX(r.start_date) as last_ride_date
FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.username, u.first_name, u.last_name, u.profile_picture_url;
```

### 3.4 Ride Sync Strategy

**Initial Sync (New User):**
- Call `GET /api/v3/athlete/activities` with pagination (`page` + `per_page=200`)
- Fetch all pages until no more results
- Store all rides in database
- **Critical**: Respect Strava rate limits (100 requests per 15 minutes, 1000 per day)
- Show progress indicator during initial sync

**Incremental Sync (Returning User):**
- Use `after` parameter with epoch timestamp of last sync
- `GET /api/v3/athlete/activities?after={last_sync_epoch}`
- Only fetches activities created after the timestamp
- Store `last_sync_at` in user record

**Webhook-Based Real-Time Sync (Advanced):**
- Subscribe via `POST /api/v3/push_subscriptions`
- Receive push notifications when user creates/updates/deletes activities
- Respond with 200 OK immediately, process asynchronously
- Fetch full activity details via `GET /api/v3/activities/{id}`

### 3.5 Route Classification Logic

For classifying rides into route categories (Bayway, Skyline, HMBW, Royale), common approaches include:

**Approach 1: Segment-Based Classification**
- Define a set of Strava segments that define each route corridor
- Check if a ride includes any/all of those segments via the activity's `segment_efforts`
- Classify based on which corridor's segments are matched

**Approach 2: Polyline Geo-Matching**
- Decode the ride's `summary_polyline` (Google Encoded Polyline format)
- Compare against reference polylines for each corridor
- Use geographic bounding boxes or corridor waypoints
- Calculate overlap percentage

**Approach 3: Start/End + Waypoint Matching**
- Check start/end coordinates are within expected zones
- Check if ride passes through corridor-specific waypoints
- Simpler but less accurate

**Recommendation for SF2G**: Segment-based classification is most reliable since Strava already provides `segment_efforts` in activity data, and the SF2G routes have well-known Strava segments.

### 3.6 Leaderboard Calculation

**Typical Ranking Approaches:**
- **Total Ride Count**: Simple count of qualifying rides
- **Total Distance**: Sum of all ride distances
- **Composite Score**: Weighted formula (rides × distance × elevation)
- **Time-Windowed**: Rankings for current month/year vs all-time
- **Route-Specific**: Separate leaderboards per route corridor

**Performance Considerations:**
- Use materialized views or pre-computed tables for leaderboard data
- Refresh on write (when new rides are synced) or on schedule
- Cache aggressively on the frontend with TanStack Query's `staleTime`

---

## 4. Architecture Patterns to Adopt

### 4.1 Recommended Architecture for SF2G

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (TanStack Start)            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ Auth Flow    │  │ Leaderboard  │  │ Ride History   │ │
│  │ (Strava OAuth)│ │ (TanStack    │  │ (Activity List)│ │
│  │              │  │  Table)      │  │                │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘ │
│         │                 │                   │          │
│         └────────┬────────┴───────────────────┘          │
│                  │ TanStack Query                        │
└──────────────────┼──────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────┐
│              Backend (Supabase)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Auth/Tokens  │  │ PostgreSQL   │  │ Edge Functions │  │
│  │ (encrypted)  │  │ (rides, users│  │ (Strava sync)  │  │
│  │              │  │  leaderboard)│  │                │  │
│  └──────────────┘  └──────────────┘  └───────┬────────┘  │
└──────────────────────────────────────────────┼───────────┘
                                               │
                                               ▼
                                    ┌──────────────────┐
                                    │ Strava API v3    │
                                    │ (OAuth + Data)   │
                                    └──────────────────┘
```

### 4.2 Key Patterns

1. **Server-Side Token Management**: Never expose Strava tokens to the client. Use Supabase Edge Functions or server-side routes in TanStack Start to proxy Strava API calls.

2. **Incremental Sync with Timestamp**: Store `last_sync_at` per user, use `after` parameter on Strava API.

3. **Rate Limit Awareness**: Queue sync requests, implement backoff, track usage against 100 req/15min limit.

4. **Optimistic UI**: Show cached leaderboard data immediately, update in background.

5. **Row Level Security**: Supabase RLS ensures users can only modify their own data but read community-wide leaderboard data.

---

## 5. Lessons Learned & Recommendations

### 5.1 What to Emulate

| Pattern | Why |
|---------|-----|
| **Strava OAuth as primary auth** | No password management, instant trust from cycling community |
| **Community leaderboard as hero feature** | Creates engagement and competitive motivation |
| **Automatic ride sync** | Zero manual effort for users after initial setup |
| **Route categorization** | Enables meaningful competition (compare Skyline riders vs Skyline riders) |
| **Public leaderboard** | Allows non-authenticated browsing to drive sign-ups |

### 5.2 What to Improve / Do Differently

| Area | Issue with Typical Implementations | Our Approach |
|------|--------------------------------------|--------------|
| **Initial sync UX** | Long wait with no feedback | Show progress bar with ride count, allow browsing during sync |
| **Route classification** | Manual tagging or simple heuristics | Segment-based classification with confidence scoring |
| **Token management** | Tokens stored in plaintext | Encrypt Strava tokens at rest in Supabase with `pgcrypto` |
| **Offline resilience** | App breaks when backend is down | IndexedDB fallback with stale-data banner (per project brief) |
| **Leaderboard performance** | Recalculated on every request | Materialized views refreshed on sync, cached by TanStack Query |
| **Mobile experience** | Desktop-first, mobile afterthought | Mobile-first responsive design from day 1 |
| **Accessibility** | Often ignored in hobby projects | WCAG AA compliance from the start |

### 5.3 Architecture Anti-Patterns to Avoid

1. **Client-side Strava API calls**: Exposes tokens and client secret
2. **Storing raw Strava responses**: Normalize data into your schema
3. **Unbounded sync**: Always paginate and respect rate limits
4. **No token refresh handling**: Tokens expire in ~6 hours; implement transparent refresh
5. **Monolithic data fetching**: Use TanStack Query for granular cache management
6. **No error boundaries**: Strava API can be flaky; graceful degradation is essential

---

## 6. Open Questions for the Architect

1. **Webhook vs Polling**: Should we implement Strava webhooks for real-time sync, or is polling sufficient for MVP? Webhooks require a publicly-accessible endpoint.

2. **Route Classification Granularity**: The project brief mentions 4 main corridors, but each has "countless variations." Should we classify only the 4 main categories, or support sub-routes?

3. **Leaderboard Scope**: Should the leaderboard rank by total rides, total distance, or a composite score? Should there be time-windowed leaderboards (monthly, yearly)?

4. **Public vs Private**: Should the leaderboard be publicly viewable without authentication, or require Strava login to see any data?

5. **Data Retention**: How long do we keep ride data? Should there be an archive strategy?

6. **Multi-Route Rides**: How do we handle rides that traverse multiple corridors (e.g., start Bayway, switch to Skyline)?

7. **Strava API Scope**: Do we need `activity:read_all` (includes private activities) or just `activity:read`? Commutes might be marked private.

---

## 7. Reference Links

- Strava API v3 Docs: https://developers.strava.com/docs/reference/
- Strava OAuth: https://developers.strava.com/docs/authentication/
- Strava Webhooks: https://developers.strava.com/docs/webhooks/
- Pagemilling Site: https://pagemilling.com/
- Pagemilling Source: https://github.com/maugt/pagemilling
- Strava Rate Limits: 100 requests / 15 minutes, 1000 / day
- SF2G Routes: https://sf2g.com/
