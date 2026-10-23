# Strava API v3 — Deep Research for SF2G Commute Tracker

> Research conducted 2026-05-25. Sources: Strava Developer Documentation, API Reference, Community Resources.

## Table of Contents

1. [OAuth 2.0 Authorization Flow](#1-oauth-20-authorization-flow)
2. [Activity Endpoints](#2-activity-endpoints)
3. [Activity Streams (GPS Data)](#3-activity-streams-gps-data)
4. [Rate Limiting](#4-rate-limiting)
5. [Segment Data & Route Classification](#5-segment-data--route-classification)
6. [Webhooks (Push Notifications)](#6-webhooks-push-notifications)
7. [Scopes & Permissions](#7-scopes--permissions)
8. [Polyline Map Data](#8-polyline-map-data)
9. [Key Gotchas & Considerations](#9-key-gotchas--considerations)

---

## 1. OAuth 2.0 Authorization Flow

Strava uses the standard **OAuth 2.0 Authorization Code Grant** flow for web applications.

### Prerequisites

- Register an application at https://www.strava.com/settings/api
- You'll receive a **Client ID** and **Client Secret**
- Configure your **Authorization Callback Domain** (e.g., `localhost` for dev, `yourdomain.com` for prod)

### Step 1: Redirect User to Strava Authorization

```
GET https://www.strava.com/oauth/authorize
```

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `client_id` | Yes | Your application's Client ID |
| `redirect_uri` | Yes | URL where Strava redirects after auth. Must match callback domain in app settings |
| `response_type` | Yes | Must be `code` |
| `approval_prompt` | No | `auto` (default) — skip if already authorized. `force` — always show approval screen |
| `scope` | Yes | Comma-separated list of scopes (see §7) |
| `state` | No | Returned unchanged in redirect. Use for CSRF protection |

**Example:**
```
https://www.strava.com/oauth/authorize?client_id=12345&redirect_uri=https://myapp.com/auth/callback&response_type=code&scope=read,activity:read_all&state=abc123
```

### Step 2: User Approves → Redirect Back with Code

After the user approves, Strava redirects to:
```
https://myapp.com/auth/callback?code=AUTHORIZATION_CODE&scope=read,activity:read_all&state=abc123
```

> **Note:** The `scope` parameter in the redirect tells you which scopes the user actually granted. Users can de-select scopes! Always verify the returned scope matches what you need.

### Step 3: Exchange Authorization Code for Tokens

```
POST https://www.strava.com/oauth/token
```

**Request Body (form-encoded or JSON):**

| Parameter | Value |
|---|---|
| `client_id` | Your Client ID |
| `client_secret` | Your Client Secret |
| `code` | The authorization code from Step 2 |
| `grant_type` | `authorization_code` |

**Response (200 OK):**
```json
{
  "token_type": "Bearer",
  "expires_at": 1568775134,
  "expires_in": 21600,
  "refresh_token": "e5n567567...",
  "access_token": "a4b945687g...",
  "athlete": {
    "id": 134815,
    "username": "JohnDoe",
    "firstname": "John",
    "lastname": "Doe",
    "city": "San Francisco",
    "state": "California",
    "profile": "https://...",
    "profile_medium": "https://..."
  }
}
```

> **Important:** The token exchange response includes an `athlete` summary object! This means you get the user's profile data for free during login — no extra API call needed.

### Step 4: Refresh Expired Tokens

Access tokens expire after **6 hours** (`expires_in: 21600`). Use the refresh token to get a new one:

```
POST https://www.strava.com/oauth/token
```

**Request Body:**

| Parameter | Value |
|---|---|
| `client_id` | Your Client ID |
| `client_secret` | Your Client Secret |
| `grant_type` | `refresh_token` |
| `refresh_token` | The stored refresh token |

**Response:**
```json
{
  "token_type": "Bearer",
  "access_token": "new_access_token...",
  "expires_at": 1568775134,
  "expires_in": 21600,
  "refresh_token": "new_refresh_token..."
}
```

> **Critical:** The refresh response may return a **new** `refresh_token`. You MUST store and use the latest refresh token. The old one may be invalidated.

### Deauthorization

To fully revoke access:
```
POST https://www.strava.com/oauth/deauthorize
Authorization: Bearer ACCESS_TOKEN
```

---

## 2. Activity Endpoints

### GET /api/v3/athlete/activities — List Athlete Activities

Returns a list of the authenticated athlete's activities as **Summary Activity** objects (not full detail).

```
GET https://www.strava.com/api/v3/athlete/activities
Authorization: Bearer ACCESS_TOKEN
```

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `before` | integer (epoch) | Filter: activities before this timestamp |
| `after` | integer (epoch) | Filter: activities after this timestamp |
| `page` | integer | Page number (default: 1) |
| `per_page` | integer | Items per page (default: 30, **max: 200**) |

**Incremental Sync Strategy:** Use the `after` parameter with the epoch timestamp of the user's most recently synced activity. This avoids re-fetching old data.

**Summary Activity Response Fields:**

| Field | Type | Description |
|---|---|---|
| `id` | integer | Unique activity identifier |
| `name` | string | Activity name |
| `distance` | float | Distance in meters |
| `moving_time` | integer | Moving time in seconds |
| `elapsed_time` | integer | Elapsed time in seconds |
| `total_elevation_gain` | float | Elevation gain in meters |
| `type` | string | Activity type: `Ride`, `Run`, etc. |
| `sport_type` | string | More specific: `MountainBikeRide`, `GravelRide`, etc. |
| `start_date` | string | ISO 8601 start time (UTC) |
| `start_date_local` | string | ISO 8601 start time (local timezone) |
| `timezone` | string | Timezone string |
| `start_latlng` | [float, float] | Start coordinates [lat, lng] |
| `end_latlng` | [float, float] | End coordinates [lat, lng] |
| `map` | object | Contains `id`, `summary_polyline`, `resource_state` |
| `commute` | boolean | **Marked as commute by user** |
| `private` | boolean | Private activity |
| `average_speed` | float | Average speed (m/s) |
| `max_speed` | float | Max speed (m/s) |

> **Key insight for SF2G:** The `commute` field lets users mark rides as commutes in Strava. We could use this as a signal (but shouldn't rely on it — many riders don't mark commutes). The `map.summary_polyline` gives us a compressed route without an extra API call.

### GET /api/v3/activities/{id} — Get Activity Detail

Returns a **Detailed Activity** with segment efforts and additional data.

```
GET https://www.strava.com/api/v3/activities/{id}
Authorization: Bearer ACCESS_TOKEN
```

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `include_all_efforts` | boolean | If `true`, includes ALL segment efforts (not just top efforts) |

**Additional fields over Summary Activity:**

| Field | Type | Description |
|---|---|---|
| `segment_efforts` | array | **List of segment effort objects** |
| `map.polyline` | string | **Full-resolution polyline** (vs summary_polyline) |
| `description` | string | Activity description |
| `calories` | float | Kilocalories consumed |
| `gear` | object | Gear used |

**Segment Effort Object Structure:**

```json
{
  "id": 12345678,
  "name": "Segment Name",
  "elapsed_time": 234,
  "moving_time": 230,
  "start_date": "2024-01-15T08:30:00Z",
  "distance": 1500.0,
  "segment": {
    "id": 913443,
    "name": "Skyline Blvd Climb",
    "activity_type": "Ride",
    "distance": 1500.0,
    "average_grade": 4.2,
    "maximum_grade": 12.0,
    "elevation_high": 350.0,
    "elevation_low": 200.0,
    "start_latlng": [37.58, -122.45],
    "end_latlng": [37.60, -122.44],
    "climb_category": 3
  }
}
```

> **This is critical for route classification!** The `segment_efforts` array tells us exactly which Strava segments a rider traversed.

---

## 3. Activity Streams (GPS Data)

### GET /api/v3/activities/{id}/streams

```
GET https://www.strava.com/api/v3/activities/{id}/streams?keys=latlng,time,distance,altitude&key_by_type=true
```

**Available Stream Keys:** `latlng`, `time`, `distance`, `altitude`, `velocity_smooth`, `heartrate`, `cadence`, `watts`, `temp`, `grade_smooth`, `moving`

> **For SF2G:** We likely do NOT need full streams for every activity. The `summary_polyline` from the activity list + segment efforts should be sufficient for route classification.

---

## 4. Rate Limiting

### Default Limits

| Tier | Limit | Window |
|---|---|---|
| Short-term | **200 requests** | Per 15-minute window |
| Long-term | **2,000 requests** | Per day (resets at midnight UTC) |

> **Note:** The project brief mentions "100 requests / 15 minutes" — this appears to be outdated. Current docs indicate **200/15min** and **2,000/day**.

### Response Headers

```
X-RateLimit-Limit: 200,2000
X-RateLimit-Usage: 15,250
```

### Rate Limit Exceeded (HTTP 429)

When limits are exceeded, the API returns HTTP 429 Too Many Requests.

### Recommended Backoff Strategy

```typescript
const RATE_LIMIT_15MIN = 200;
const RATE_LIMIT_DAILY = 2000;

function shouldThrottle(state: RateLimitState): boolean {
  return state.usage15min >= RATE_LIMIT_15MIN * 0.9
    || state.usageDaily >= RATE_LIMIT_DAILY * 0.9;
}

async function fetchWithBackoff(url: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(Math.pow(2, i) * 1000);
      continue;
    }
    return res;
  }
  throw new Error('Max retries exceeded');
}
```

---

## 5. Segment Data & Route Classification

### Route Classification Strategy for SF2G

#### Approach A: Segment-Based Classification (Recommended)

1. Identify "sentinel segments" unique to each corridor
2. Check `segment_efforts` on each activity
3. Match segment IDs against corridor-to-segment mapping

#### Approach B: Polyline/GPS-Based Classification

1. Decode `summary_polyline`
2. Define geographic bounding corridors
3. Check if decoded GPS trace passes through defining geography

#### Approach C: Hybrid (Best)

1. **Primary:** Segment-based matching (fast, precise)
2. **Fallback:** Decode polyline and use geographic bounding boxes
3. **Manual override:** Let users correct classification

### Explore Segments API

```
GET /api/v3/segments/explore?bounds=37.5,-122.5,37.8,-122.3&activity_type=riding
```

---

## 6. Webhooks (Push Notifications)

**Yes, Strava supports webhooks!**

### How It Works

1. **Create a subscription** — Register callback URL with Strava
2. **Receive events** — Strava POSTs when activities are created/updated/deleted
3. **Fetch details** — Use activity ID from webhook to call API for full data

### Creating a Subscription

```
POST https://www.strava.com/api/v3/push_subscriptions
```

| Parameter | Description |
|---|---|
| `client_id` | Your application's Client ID |
| `client_secret` | Your application's Client Secret |
| `callback_url` | Your webhook endpoint URL (must be HTTPS) |
| `verify_token` | A string you define for validation |

> **Limit:** Only **one subscription per application**.

### Event Payload

```json
{
  "aspect_type": "create",
  "event_time": 1516126040,
  "object_id": 1234567890,
  "object_type": "activity",
  "owner_id": 123456,
  "subscription_id": 123456,
  "updates": {}
}
```

> **Important:** The webhook payload only contains the **ID**, not the activity data. You must call `GET /activities/{object_id}` to get actual data.

---

## 7. Scopes & Permissions

### Recommended Scopes for SF2G

```
scope=read,activity:read_all
```

- **`read`** — Basic API access and public profile info
- **`activity:read_all`** — Essential: many cyclists mark commutes as private

---

## 8. Polyline Map Data

| Field | Source | Resolution | API Call Needed |
|---|---|---|---|
| `map.summary_polyline` | Activity List | Low (~100-200 points) | No (comes with list) |
| `map.polyline` | Activity Detail | Full resolution | Yes |

Both use Google's Encoded Polyline Algorithm. Decode with `@mapbox/polyline` npm package.

---

## 9. Key Gotchas & Considerations

### Authentication Gotchas
1. **Refresh tokens change** — After each refresh, store the new refresh token
2. **Token expiry is 6 hours** — Need proactive refresh before API calls
3. **Users can de-select scopes** — Always check the `scope` parameter in callback
4. **Client secret must be server-side** — Never expose in frontend code

### Activity Data Gotchas
5. **`commute` flag is unreliable** — Many riders don't mark rides as commutes
6. **`type` vs `sport_type`** — Use `type === 'Ride'` to filter cycling
7. **Manual activities** — `manual: true` means no GPS data. Skip for route classification
8. **Pagination max** — `per_page` max is 200

### Rate Limit Gotchas
9. **Limits are per-application, not per-user** — All users share the same budget
10. **Initial sync is expensive** — Queue and background process
11. **Always parse rate limit headers** — Track usage proactively

### Webhook Gotchas
12. **Webhook = notification only** — Still need API call for data
13. **One subscription per app** — Can't have separate dev/prod subscriptions
14. **Callback must be HTTPS**
15. **Delivery is not guaranteed** — Implement polling as fallback

### Segment Gotchas
16. **`include_all_efforts` is optional** — Default is `false`
17. **Segment IDs are global** — Same ID across all users
18. **Some routes may lack segments** — Need fallback classification
