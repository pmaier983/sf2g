/**
 * App-wide constants for the SF2G Commute Tracker.
 *
 * Includes route gateway definitions, known landmarks, route colors,
 * and Strava API configuration.
 */
import type { RouteCategory } from "./database.types";

// ---------------------------------------------------------------------------
// Route Gateway Types & Definitions
// ---------------------------------------------------------------------------

export interface RouteGateway {
  category: RouteCategory;
  name: string;
  lat: number;
  lng: number;
  description: string;
}

/**
 * GPS gateway/checkpoint coordinates for route classification.
 * A ride is classified by which gateway(s) its decoded polyline passes through.
 * Each gateway is chosen because it's geographically exclusive to one corridor.
 *
 * The 4 corridors are geographically separated:
 * - HMBW: Coastal route (west) — goes through Devil's Slide
 * - Skyline: Ridge route (mountain) — rides along Skyline Blvd at elevation
 * - Bayway: Bay shore route (east) — follows the bay trail / Foster City
 * - Royale: Valley floor route (middle) — El Camino Real corridor
 */
export const ROUTE_GATEWAYS: RouteGateway[] = [
  // HMBW — Coastal route (west), goes through Devil's Slide area
  {
    category: "hmbw",
    name: "HMBW South (near Half Moon Bay)",
    lat: 37.448732,
    lng: -122.429176,
    description: "Coastal corridor south checkpoint, near Half Moon Bay",
  },
  {
    category: "hmbw",
    name: "HMBW North (Devil's Slide)",
    lat: 37.57803,
    lng: -122.512407,
    description:
      "Coastal corridor north checkpoint, near Devil's Slide / Pacifica",
  },

  // Skyline — Ridge route (mountain), along Skyline Blvd
  {
    category: "skyline",
    name: "Skyline North (near Daly City)",
    lat: 37.668433,
    lng: -122.485198,
    description: "Skyline Blvd northern entry near Daly City / Olympic Club",
  },
  {
    category: "skyline",
    name: "Skyline South (Kings Mountain)",
    lat: 37.489,
    lng: -122.3202,
    description:
      "Skyline Blvd southern checkpoint near Kings Mountain Rd / Woodside",
  },

  // Bayway — Bay shore route (east), follows the bay trail
  {
    category: "bayway",
    name: "Bayway North (near SFO / Millbrae)",
    lat: 37.68398,
    lng: -122.389961,
    description: "Bay Trail northern checkpoint near SFO / Millbrae",
  },
  {
    category: "bayway",
    name: "Bayway South (Foster City / San Mateo)",
    lat: 37.57918,
    lng: -122.310702,
    description: "Bay Trail southern checkpoint near Foster City / San Mateo",
  },

  // Royale — Valley floor route (middle), El Camino Real corridor
  // All Royale rides started at Cafeto on Richland Ave
  {
    category: "royale",
    name: "Royale North (Cafeto / Richland)",
    lat: 37.735942,
    lng: -122.424561,
    description: "Royale start point at Cafeto on Richland Ave, SF",
  },
  {
    category: "royale",
    name: "Royale South (Sand Hill Rd / El Camino)",
    lat: 37.446464,
    lng: -122.171229,
    description: "El Camino Real / CA-82 at Sand Hill Rd, Menlo Park",
  },

  // Fleaway — Flat route uniquely using the Centennial bike trail in SSF
  {
    category: "fleaway",
    name: "Fleaway North (Centennial Trail / SSF)",
    lat: 37.662883,
    lng: -122.442106,
    description:
      "Fleaway northern checkpoint on the Centennial bike trail in South SF",
  },
  {
    category: "fleaway",
    name: "Fleaway South (Sand Hill Rd)",
    lat: 37.426494,
    lng: -122.193272,
    description: "Fleaway southern checkpoint near Sand Hill Rd, Menlo Park",
  },

  // MEBW — Middle East Bay Way
  {
    category: "mebw",
    name: "MEBW North (Castro Valley / Hayward)",
    lat: 37.682566,
    lng: -122.177678,
    description: "Middle East Bay Way northern checkpoint near Castro Valley",
  },
  {
    category: "mebw",
    name: "MEBW South (Fremont / Milpitas)",
    lat: 37.50882,
    lng: -122.114224,
    description:
      "Middle East Bay Way southern checkpoint near Fremont / Milpitas",
  },

  // FEBW — Far East Bay Way
  {
    category: "febw",
    name: "FEBW North (Berkeley Hills / Orinda)",
    lat: 37.814338,
    lng: -122.144205,
    description:
      "Far East Bay Way northern checkpoint near Berkeley Hills / Orinda",
  },
  {
    category: "febw",
    name: "FEBW South (Dublin / Pleasanton)",
    lat: 37.669102,
    lng: -122.00122,
    description:
      "Far East Bay Way southern checkpoint near Dublin / Pleasanton",
  },
];

/**
 * Radius in meters for gateway matching.
 * A ride point must be within this distance of a gateway to count as a match.
 */
export const GATEWAY_RADIUS_METERS = 500;

// ---------------------------------------------------------------------------
// Commute Endpoint Zones
// ---------------------------------------------------------------------------

/**
 * San Francisco city bounding box.
 * Generous bounds covering the entire city area including the Presidio,
 * Treasure Island, and a small buffer into Daly City.
 */
export const SF_BOUNDS = {
  north: 37.82,
  south: 37.7,
  east: -122.34,
  west: -122.52,
} as const;

/**
 * Peninsula corridor polygon — the destination zone for SF2G commutes.
 *
 * Bounded by Highway 280 on the west and Highway 101 on the east,
 * with a ~1 mile (~1.6km) buffer outside each highway.
 *
 * Runs from where SF ends (Daly City, ~lat 37.71) south to where
 * Highways 101 and 280 converge in San Jose (~lat 37.28).
 *
 * Vertices listed clockwise starting from the northwest corner.
 * Each vertex is [latitude, longitude].
 */
export const PENINSULA_CORRIDOR: [number, number][] = [
  // West boundary (Hwy 280 + ~10% wider buffer), north to south
  [37.69, -122.54], // Daly City — stays below SF_BOUNDS.south (37.700)
  [37.63, -122.5], // San Bruno (wider west buffer)
  [37.57, -122.44], // Crystal Springs Reservoir
  [37.5, -122.38], // Woodside
  [37.44, -122.27], // Stanford foothills
  [37.39, -122.15], // Cupertino / Stevens Creek
  [37.35, -122.1], // West San Jose
  [37.25, -122.01], // South tip — 101/280 merge area (extended south)

  // East boundary (Hwy 101 + ~10% wider buffer), south to north
  [37.25, -121.85], // South tip east (extended south + wider east)
  [37.3, -121.9], // San Jose
  [37.35, -121.93], // Santa Clara
  [37.39, -121.99], // Sunnyvale
  [37.42, -122.02], // Mountain View / Google
  [37.48, -122.15], // Redwood City
  [37.57, -122.25], // San Mateo
  [37.63, -122.31], // SFO / Millbrae
  [37.69, -122.34], // South SF / Daly City east — stays below SF_BOUNDS.south
];

// ---------------------------------------------------------------------------
// Known Landmarks
// ---------------------------------------------------------------------------

export interface KnownLandmark {
  name: string;
  lat: number;
  lng: number;
  description: string;
}

/**
 * PPR intercept checkpoints — locations where the Peet's Peloton Ride
 * can be detected along its route, each with an expected local arrival time.
 * A ride qualifies as a PPR ride if it passes within 500m of ANY intercept
 * at approximately the right time (±10 min of that point's targetMinutes).
 */
export interface PprIntercept {
  lat: number;
  lng: number;
  /** Expected arrival time in minutes from midnight (local time) */
  targetMinutes: number;
  label: string;
}

export const PPR_INTERCEPTS: readonly PprIntercept[] = [
  {
    lat: 37.773433,
    lng: -122.438898,
    targetMinutes: 360,
    label: "PPR @ Peets",
  }, // 6:00 AM
  {
    lat: 37.770192,
    lng: -122.494076,
    targetMinutes: 370,
    label: "PPR @ JFK/36",
  }, // 6:10 AM
  {
    lat: 37.698411,
    lng: -122.495033,
    targetMinutes: 390,
    label: "PPR @ JD/Skyline",
  }, // 6:30 AM
] as const;

/**
 * @deprecated Use PPR_INTERCEPTS instead. Kept for backward compatibility
 * with components that only need the primary PPR location (e.g. map markers).
 */
export const PPR_COORDS: KnownLandmark = {
  name: "PPR (Peet's Coffee at Park Presidio)",
  lat: PPR_INTERCEPTS[0].lat,
  lng: PPR_INTERCEPTS[0].lng,
  description: "Classic SF2G morning departure point",
};

/** Known ride intercept points — where riders join the group mid-route */
export const KNOWN_INTERCEPTS: KnownLandmark[] = [
  {
    name: "JD/Skyline",
    lat: 37.698413,
    lng: -122.495,
    description: "Common intercept point where riders join on Skyline Blvd",
  },
  // Add more intercepts as the community identifies them
];

// ---------------------------------------------------------------------------
// Route Colors
// ---------------------------------------------------------------------------

export const ROUTE_COLORS: Record<RouteCategory, string> = {
  bayway: "#22A722",
  skyline: "#3366CC",
  hmbw: "#FF6600",
  royale: "#CC0000",
  fleaway: "#8B5CF6",
  mebw: "#06B6D4",
  febw: "#EC4899",
  other: "#6B7280",
};

export const ROUTE_LABELS: Record<RouteCategory, string> = {
  bayway: "Bayway",
  skyline: "Skyline",
  hmbw: "HMBW",
  royale: "Royale",
  fleaway: "Fleaway",
  mebw: "MEBW",
  febw: "FEBW",
  other: "Other",
};

export const ROUTE_DESCRIPTIONS: Record<RouteCategory, string> = {
  bayway:
    "Bay shore route following the bay trail through Foster City and along SFO",
  skyline: "Mountain ridge route along Skyline Blvd with serious climbing",
  hmbw: "Coastal route through Devil's Slide and Half Moon Bay — scenic and exposed",
  royale:
    "Valley floor route along El Camino Real corridor through the peninsula",
  fleaway: "Flat route via El Camino / Bayshore blend through the peninsula",
  mebw: "Middle East Bay Way — through Castro Valley and Fremont",
  febw: "Far East Bay Way — through Berkeley Hills, Orinda, and Dublin",
  other: "Unclassified or alternate route",
};

// ---------------------------------------------------------------------------
// Rider Color Palette (Top 10 chart)
// ---------------------------------------------------------------------------

/** Colors assigned to the top 10 visible riders in the growth chart */
export const RIDER_COLORS = [
  "#6366f1", // indigo
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#f97316", // orange
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
  "#eab308", // yellow
  "#64748b", // slate
] as const;

// ---------------------------------------------------------------------------
// Unit Conversions
// ---------------------------------------------------------------------------

/** Meters per second → miles per hour */
export const MPS_TO_MPH = 2.23694;

/** Meters → miles */
export const METERS_PER_MILE = 1609.34;

/** Meters → feet */
export const METERS_TO_FEET = 3.281;

// ---------------------------------------------------------------------------
// Strava API Configuration
// ---------------------------------------------------------------------------

export const STRAVA_API_BASE = "https://www.strava.com/api/v3";
export const STRAVA_OAUTH_BASE = "https://www.strava.com/oauth";
export const STRAVA_AUTHORIZE_URL = `${STRAVA_OAUTH_BASE}/authorize`;
export const STRAVA_TOKEN_URL = `${STRAVA_OAUTH_BASE}/token`;
export const STRAVA_REVOKE_URL = `${STRAVA_OAUTH_BASE}/revoke`;
export const STRAVA_DEAUTHORIZE_URL = `${STRAVA_OAUTH_BASE}/deauthorize`;
export const STRAVA_WEBHOOK_URL = `${STRAVA_API_BASE}/push_subscriptions`;

/** Strava Standard Tier Rate Limits (effective June 1, 2026) */
export const STRAVA_RATE_LIMIT = {
  LIMIT_15MIN: 200,
  LIMIT_DAILY: 2000,
  SAFETY_MARGIN: 0.85,
} as const;

export const STRAVA_SCOPES = "read,activity:read_all";

/**
 * Individual scopes that MUST be granted for the app to function.
 * If a user unchecks any checkbox on Strava's OAuth consent screen,
 * the API silently returns incomplete data (e.g. no private rides).
 */
export const STRAVA_REQUIRED_SCOPES = ["read", "activity:read_all"] as const;

/**
 * Check whether the granted scopes string contains all required scopes.
 * Strava returns scopes as a comma-separated string like "read,activity:read_all".
 *
 * @returns Array of missing scope names, or empty array if all granted.
 */
export function getMissingScopes(grantedScopes: string): string[] {
  const granted = new Set(grantedScopes.split(",").map((s) => s.trim()));
  return STRAVA_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

/**
 * Open-Meteo Free Tier Rate Limits.
 * See: https://open-meteo.com/en/terms
 *
 * Free tier allows:
 * - 600 calls / minute
 * - 5,000 calls / hour
 * - 10,000 calls / day
 *
 * We use a conservative budget for the cron job to leave headroom
 * for manual syncs and DevTools wind enrichment triggers.
 */
export const OPEN_METEO_RATE_LIMIT = {
  LIMIT_PER_MINUTE: 600,
  LIMIT_PER_HOUR: 5_000,
  LIMIT_PER_DAY: 10_000,
  /** Max API calls the cron job should use per invocation (leaves ~50% for manual use) */
  CRON_BUDGET: 200,
} as const;

/**
 * Cron sync budget for Strava API calls.
 * Reserves capacity for users manually syncing throughout the day.
 *
 * Budget allocation per 15-min window:
 * - Total: 200 requests (Strava limit)
 * - Safety margin (85%): 170 effective
 * - Cron budget: ~50% of effective = 85 requests
 * - Remaining for manual syncs: ~85 requests
 *
 * Each user's incremental sync typically uses 1-2 API calls (1 page).
 * With 85 requests budgeted, we can sync ~40-80 users per cron run.
 *
 * Cloudflare Workers subrequest limit:
 * - Free plan: 50 subrequests per invocation
 * - Paid plan: 10,000 (wrangler.jsonc sets 200 as configured limit)
 * - Each Supabase query or Strava fetch = 1 subrequest
 * - Per-user sync: ~5-7 subrequests (token check, user fetch, Strava page,
 *   ride upsert, user metadata update)
 * - MAX_USERS_PER_RUN limits users to stay within subrequest budget
 */
export const CRON_SYNC_BUDGET = {
  /** Max Strava API calls the cron job should use per run */
  MAX_STRAVA_REQUESTS: 85,
  /**
   * Max users to sync per cron invocation.
   * Each user costs ~5-7 Cloudflare subrequests. With the free plan's 50-subrequest
   * limit, we need to leave ~10 subrequests for the reclassify + wind steps.
   * Set to 6 for free plan safety; increase if on paid plan.
   */
  MAX_USERS_PER_RUN: 6,
  /** Delay between syncing each user (ms) — spreads load across the 15min window */
  DELAY_BETWEEN_USERS_MS: 2_000,
  /** Max time allowed for the entire sync-all-users operation (ms) */
  MAX_TOTAL_DURATION_MS: 10 * 60 * 1000, // 10 minutes
} as const;

// ---------------------------------------------------------------------------
// Route Waypoints (for weather forecast sampling)
// ---------------------------------------------------------------------------

export interface RouteWaypoint {
  lat: number;
  lng: number;
  mile: number;
  label: string;
}

/** Simplified waypoints per route for weather sampling (8-10 points each) */
export const ROUTE_WAYPOINTS: Record<string, RouteWaypoint[]> = {
  bayway: [
    { lat: 37.773, lng: -122.439, mile: 0, label: "Peets / Start" },
    { lat: 37.755, lng: -122.418, mile: 2, label: "Mission / UCSF" },
    { lat: 37.728, lng: -122.4, mile: 4, label: "Glen Park" },
    { lat: 37.69, lng: -122.4, mile: 7, label: "Daly City" },
    { lat: 37.66, lng: -122.39, mile: 10, label: "South SF / SFO" },
    { lat: 37.63, lng: -122.37, mile: 13, label: "Millbrae" },
    { lat: 37.58, lng: -122.31, mile: 18, label: "Foster City / San Mateo" },
    { lat: 37.54, lng: -122.28, mile: 22, label: "Belmont / San Carlos" },
    { lat: 37.5, lng: -122.26, mile: 26, label: "Redwood City" },
    { lat: 37.45, lng: -122.18, mile: 30, label: "Palo Alto / Mountain View" },
  ],
  skyline: [
    { lat: 37.773, lng: -122.439, mile: 0, label: "Peets / Start" },
    { lat: 37.755, lng: -122.45, mile: 2, label: "Golden Gate Park" },
    { lat: 37.73, lng: -122.47, mile: 4, label: "Sunset / Lake Merced" },
    { lat: 37.69, lng: -122.485, mile: 7, label: "Daly City / Skyline entry" },
    { lat: 37.63, lng: -122.47, mile: 12, label: "San Bruno Mountain" },
    { lat: 37.57, lng: -122.44, mile: 18, label: "Crystal Springs" },
    { lat: 37.52, lng: -122.35, mile: 24, label: "Woodside" },
    { lat: 37.45, lng: -122.28, mile: 30, label: "Stanford / Palo Alto" },
  ],
  hmbw: [
    { lat: 37.773, lng: -122.439, mile: 0, label: "Peets / Start" },
    { lat: 37.755, lng: -122.5, mile: 3, label: "Great Highway" },
    { lat: 37.7, lng: -122.505, mile: 6, label: "Pacifica / Sharp Park" },
    { lat: 37.63, lng: -122.49, mile: 10, label: "Devil's Slide" },
    { lat: 37.55, lng: -122.51, mile: 16, label: "Half Moon Bay (north)" },
    { lat: 37.47, lng: -122.43, mile: 22, label: "Half Moon Bay (south)" },
    { lat: 37.4, lng: -122.35, mile: 28, label: "Hwy 92 / inland" },
    { lat: 37.45, lng: -122.18, mile: 35, label: "Peninsula (south)" },
  ],
  royale: [
    { lat: 37.773, lng: -122.439, mile: 0, label: "Peets / Start" },
    { lat: 37.74, lng: -122.42, mile: 2, label: "Mission / Cesar Chavez" },
    { lat: 37.71, lng: -122.405, mile: 5, label: "Bernal Heights" },
    { lat: 37.66, lng: -122.405, mile: 8, label: "Daly City / Colma" },
    { lat: 37.61, lng: -122.4, mile: 12, label: "South SF / El Camino" },
    { lat: 37.57, lng: -122.34, mile: 16, label: "San Mateo" },
    { lat: 37.52, lng: -122.28, mile: 21, label: "San Carlos / Belmont" },
    { lat: 37.45, lng: -122.18, mile: 28, label: "Palo Alto / Mountain View" },
  ],
};
