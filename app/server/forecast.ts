/**
 * Route weather forecast server function.
 *
 * Fetches hourly weather data along a route corridor from the Open-Meteo
 * Forecast API (free, no API key needed). Computes estimated arrival time
 * at each waypoint based on distance and average speed, then maps each
 * waypoint to the closest hourly forecast data.
 */
import { createServerFn } from '@tanstack/react-start'
import { ROUTE_WAYPOINTS } from '../lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteWeatherPoint {
  lat: number
  lng: number
  mile: number
  label: string
  estimatedArrival: string // ISO datetime
  temperature: number      // °F
  precipitation: number    // mm
  precipProb: number       // %
  cloudCover: number       // %
  visibility: number       // meters
  windSpeed: number        // mph
  windDirection: number    // degrees
  windGusts: number        // mph
  weatherCode: number      // WMO code
  isDay: boolean
  headwindComponent: number // mph (positive = headwind, negative = tailwind)
  travelBearing: number    // degrees (direction of travel)
}

export interface ForecastResult {
  waypoints: RouteWeatherPoint[]
  sunrise: string
  sunset: string
  summary: {
    avgTemp: number
    maxPrecipProb: number
    avgCloudCover: number
    avgVisibility: number
    avgWindSpeed: number
    dominantWindDirection: number
    weatherDescription: string
    avgHeadwind: number        // mph (positive = headwind, negative = tailwind)
    overallRainProb: number    // % — max rain probability across all waypoints
    fogProbability: number     // % — estimated fog probability
    dominantWindEffect: 'headwind' | 'tailwind' | 'crosswind'
  }
}

// ---------------------------------------------------------------------------
// Open-Meteo Forecast API response shape (internal)
// ---------------------------------------------------------------------------

interface OpenMeteoForecastResponse {
  hourly?: {
    time?: string[]
    temperature_2m?: number[]
    precipitation?: number[]
    precipitation_probability?: number[]
    weathercode?: number[]
    windspeed_10m?: number[]
    winddirection_10m?: number[]
    windgusts_10m?: number[]
    cloudcover?: number[]
    visibility?: number[]
    is_day?: number[]
  }
  daily?: {
    sunrise?: string[]
    sunset?: string[]
  }
}

// ---------------------------------------------------------------------------
// WMO Weather Code descriptions
// ---------------------------------------------------------------------------

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Calculate compass bearing from point A to point B.
 */
function calcBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const lat1Rad = (lat1 * Math.PI) / 180
  const lat2Rad = (lat2 * Math.PI) / 180

  const y = Math.sin(dLng) * Math.cos(lat2Rad)
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Calculate headwind component along the travel direction.
 *
 * Returns positive value for headwind (wind opposing travel),
 * negative for tailwind (wind assisting travel).
 *
 * SF2G routes travel roughly NW → SE (bearing ~140°).
 * A NW wind (windDirection=315°) blows FROM the NW, pushing riders SE.
 * That's a TAILWIND, so the result should be NEGATIVE.
 *
 * Example:
 *   - travelBearing = 140° (NW to SE)
 *   - windDirection = 315° (wind FROM NW)
 *   - windTo = (315+180) % 360 = 135° (wind pushes toward SE)
 *   - diff = 135 - 140 = -5° (nearly aligned with travel)
 *   - cos(-5°) ≈ 1.0 → result = -1.0 × speed → TAILWIND ✓
 *
 *   - windDirection = 135° (wind FROM SE, blowing INTO the rider)
 *   - windTo = (135+180) % 360 = 315° (wind pushes toward NW)
 *   - diff = 315 - 140 = 175° (nearly opposite travel)
 *   - cos(175°) ≈ -1.0 → result = +1.0 × speed → HEADWIND ✓
 */
function calcHeadwindComponent(
  windSpeed: number,
  windDirection: number,
  travelBearing: number,
): number {
  // Wind blows FROM windDirection, so it pushes TOWARD windDirection + 180
  const windTo = (windDirection + 180) % 360
  // Angle difference between wind push direction and travel direction
  let diff = windTo - travelBearing
  // Normalize to -180..180
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  // cos(0) = 1 means wind pushes exactly in travel direction (tailwind)
  // cos(180) = -1 means wind pushes exactly opposite travel (headwind)
  // We negate so: positive = headwind, negative = tailwind
  const cosAngle = Math.cos((diff * Math.PI) / 180)
  return Math.round(-cosAngle * windSpeed * 10) / 10
}

/**
 * Estimate fog probability based on visibility and weather codes.
 * WMO codes 45 (Fog) and 48 (Depositing rime fog) indicate fog.
 * Low visibility (<5km) also suggests fog/mist.
 */
function estimateFogProb(waypoints: { visibility: number; weatherCode: number }[]): number {
  if (waypoints.length === 0) return 0
  let fogScore = 0
  for (const wp of waypoints) {
    if (wp.weatherCode === 45 || wp.weatherCode === 48) {
      fogScore += 100
    } else if (wp.visibility < 1000) {
      fogScore += 80
    } else if (wp.visibility < 3000) {
      fogScore += 50
    } else if (wp.visibility < 5000) {
      fogScore += 25
    } else if (wp.visibility < 8000) {
      fogScore += 10
    }
  }
  return Math.min(100, Math.round(fogScore / waypoints.length))
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_ROUTES = new Set(Object.keys(ROUTE_WAYPOINTS))

function validateDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const fetchRouteForecast = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: {
      route: string           // 'bayway' | 'skyline' | 'hmbw' | 'royale'
      date: string            // 'YYYY-MM-DD'
      departureHour: number   // 5-9 (AM)
      avgSpeedMph: number     // 10-30 typical
    }) => {
      // Validate route name against allow-list
      if (!VALID_ROUTES.has(input.route)) {
        throw new Error(`Invalid route: ${input.route}`)
      }
      // Validate date format
      if (!validateDate(input.date)) {
        throw new Error(`Invalid date format: ${input.date}`)
      }
      // Clamp numeric inputs to reasonable ranges
      return {
        route: input.route,
        date: input.date,
        departureHour: clamp(input.departureHour, 4, 10),
        avgSpeedMph: clamp(input.avgSpeedMph, 5, 35),
      }
    },
  )
  .handler(async ({ data }): Promise<ForecastResult> => {
    const waypoints = ROUTE_WAYPOINTS[data.route]
    if (!waypoints || waypoints.length === 0) {
      throw new Error(`No waypoints found for route: ${data.route}`)
    }

    // 1. Calculate arrival time at each waypoint
    const departureTime = new Date(`${data.date}T00:00:00-07:00`)
    departureTime.setHours(Math.floor(data.departureHour))
    departureTime.setMinutes((data.departureHour % 1) * 60)

    const waypointArrivals = waypoints.map((wp) => {
      const hoursToPoint = wp.mile / data.avgSpeedMph
      const arrival = new Date(departureTime.getTime() + hoursToPoint * 3600_000)
      return { ...wp, arrival }
    })

    // 2. Call Open-Meteo Forecast API (batch all lat/lngs)
    const lats = waypoints.map((wp) => wp.lat.toFixed(4)).join(',')
    const lngs = waypoints.map((wp) => wp.lng.toFixed(4)).join(',')

    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', lats)
    url.searchParams.set('longitude', lngs)
    url.searchParams.set(
      'hourly',
      'temperature_2m,precipitation,precipitation_probability,weathercode,windspeed_10m,winddirection_10m,windgusts_10m,cloudcover,visibility,is_day',
    )
    url.searchParams.set('daily', 'sunrise,sunset')
    url.searchParams.set('temperature_unit', 'fahrenheit')
    url.searchParams.set('windspeed_unit', 'mph')
    url.searchParams.set('timezone', 'America/Los_Angeles')
    url.searchParams.set('forecast_days', '7')

    const response = await fetch(url.toString())

    if (!response.ok) {
      console.error(`[forecast] Open-Meteo API error: ${response.status} ${response.statusText}`)
      throw new Error('Failed to fetch weather forecast')
    }

    const apiData = await response.json()

    // Open-Meteo returns an array when multiple locations are requested
    const locations: OpenMeteoForecastResponse[] = Array.isArray(apiData)
      ? apiData
      : [apiData]

    // 3. Map each waypoint to closest hourly forecast data
    const weatherPoints: RouteWeatherPoint[] = waypointArrivals.map((wp, i) => {
      const location = locations[Math.min(i, locations.length - 1)]
      const hourly = location.hourly

      if (!hourly?.time) {
        // Fallback: return zeros if no data
        return {
          lat: wp.lat,
          lng: wp.lng,
          mile: wp.mile,
          label: wp.label,
          estimatedArrival: wp.arrival.toISOString(),
          temperature: 0,
          precipitation: 0,
          precipProb: 0,
          cloudCover: 0,
          visibility: 10000,
          windSpeed: 0,
          windDirection: 0,
          windGusts: 0,
          weatherCode: 0,
          isDay: true,
          headwindComponent: 0,
          travelBearing: 0,
        }
      }

      // Find the closest hourly time to the estimated arrival
      const arrivalMs = wp.arrival.getTime()
      let closestIdx = 0
      let closestDiff = Infinity
      for (let j = 0; j < hourly.time.length; j++) {
        const timeMs = new Date(hourly.time[j]).getTime()
        const diff = Math.abs(timeMs - arrivalMs)
        if (diff < closestDiff) {
          closestDiff = diff
          closestIdx = j
        }
      }

      return {
        lat: wp.lat,
        lng: wp.lng,
        mile: wp.mile,
        label: wp.label,
        estimatedArrival: wp.arrival.toISOString(),
        temperature: hourly.temperature_2m?.[closestIdx] ?? 0,
        precipitation: hourly.precipitation?.[closestIdx] ?? 0,
        precipProb: hourly.precipitation_probability?.[closestIdx] ?? 0,
        cloudCover: hourly.cloudcover?.[closestIdx] ?? 0,
        visibility: hourly.visibility?.[closestIdx] ?? 10000,
        windSpeed: hourly.windspeed_10m?.[closestIdx] ?? 0,
        windDirection: hourly.winddirection_10m?.[closestIdx] ?? 0,
        windGusts: hourly.windgusts_10m?.[closestIdx] ?? 0,
        weatherCode: hourly.weathercode?.[closestIdx] ?? 0,
        isDay: (hourly.is_day?.[closestIdx] ?? 1) === 1,
        headwindComponent: 0,  // computed below
        travelBearing: 0,      // computed below
      }
    })

    // Compute travel bearing and headwind component for each waypoint
    for (let i = 0; i < weatherPoints.length; i++) {
      const next = weatherPoints[Math.min(i + 1, weatherPoints.length - 1)]
      const current = weatherPoints[i]
      const tb = calcBearing(current.lat, current.lng, next.lat, next.lng)
      current.travelBearing = Math.round(tb)
      current.headwindComponent = calcHeadwindComponent(
        current.windSpeed,
        current.windDirection,
        tb,
      )
    }

    // 4. Get sunrise/sunset from the first location's daily data for the requested date
    const firstDaily = locations[0]?.daily
    const dateIdx = firstDaily?.sunrise?.findIndex((s) => s.startsWith(data.date)) ?? 0
    const sunrise = firstDaily?.sunrise?.[Math.max(0, dateIdx)] ?? ''
    const sunset = firstDaily?.sunset?.[Math.max(0, dateIdx)] ?? ''

    // 5. Compute summary stats
    const temps = weatherPoints.map((wp) => wp.temperature)
    const precipProbs = weatherPoints.map((wp) => wp.precipProb)
    const cloudCovers = weatherPoints.map((wp) => wp.cloudCover)
    const visibilities = weatherPoints.map((wp) => wp.visibility)
    const windSpeeds = weatherPoints.map((wp) => wp.windSpeed)
    const windDirs = weatherPoints.map((wp) => wp.windDirection)

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

    // Dominant wind direction: circular mean
    const sinSum = windDirs.reduce(
      (sum, d) => sum + Math.sin((d * Math.PI) / 180),
      0,
    )
    const cosSum = windDirs.reduce(
      (sum, d) => sum + Math.cos((d * Math.PI) / 180),
      0,
    )
    const dominantDir =
      ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360

    // Most common weather code for description
    const codeCounts = new Map<number, number>()
    for (const wp of weatherPoints) {
      codeCounts.set(wp.weatherCode, (codeCounts.get(wp.weatherCode) ?? 0) + 1)
    }
    let dominantCode = 0
    let maxCount = 0
    for (const [code, count] of codeCounts) {
      if (count > maxCount) {
        maxCount = count
        dominantCode = code
      }
    }

    // Compute headwind stats
    const headwinds = weatherPoints.map((wp) => wp.headwindComponent)
    const avgHeadwind = Math.round(avg(headwinds) * 10) / 10

    // Determine dominant wind effect
    let dominantWindEffect: 'headwind' | 'tailwind' | 'crosswind'
    if (avgHeadwind > 3) dominantWindEffect = 'headwind'
    else if (avgHeadwind < -3) dominantWindEffect = 'tailwind'
    else dominantWindEffect = 'crosswind'

    // Fog probability
    const fogProbability = estimateFogProb(weatherPoints)

    return {
      waypoints: weatherPoints,
      sunrise,
      sunset,
      summary: {
        avgTemp: Math.round(avg(temps) * 10) / 10,
        maxPrecipProb: Math.max(...precipProbs, 0),
        avgCloudCover: Math.round(avg(cloudCovers)),
        avgVisibility: Math.round(avg(visibilities)),
        avgWindSpeed: Math.round(avg(windSpeeds) * 10) / 10,
        dominantWindDirection: Math.round(dominantDir),
        weatherDescription: WMO_CODES[dominantCode] ?? 'Unknown',
        avgHeadwind,
        overallRainProb: Math.max(...precipProbs, 0),
        fogProbability,
        dominantWindEffect,
      },
    }
  })

// ---------------------------------------------------------------------------
// Wind Grid — regional wind data for the wind map
// ---------------------------------------------------------------------------

export interface WindGridPoint {
  lat: number
  lng: number
  label: string
  windSpeed: number      // mph
  windDirection: number  // degrees
  windGusts: number      // mph
}

/** Grid of points across the SF Bay Area for regional wind visualization */
const WIND_GRID_POINTS = [
  { lat: 37.80, lng: -122.47, label: 'Golden Gate' },
  { lat: 37.78, lng: -122.39, label: 'Downtown SF' },
  { lat: 37.75, lng: -122.50, label: 'Ocean Beach' },
  { lat: 37.72, lng: -122.44, label: 'Twin Peaks' },
  { lat: 37.68, lng: -122.48, label: 'Daly City' },
  { lat: 37.65, lng: -122.40, label: 'South SF' },
  { lat: 37.60, lng: -122.35, label: 'San Bruno' },
  { lat: 37.56, lng: -122.30, label: 'San Mateo' },
  { lat: 37.52, lng: -122.25, label: 'Belmont' },
  { lat: 37.48, lng: -122.22, label: 'Redwood City' },
  { lat: 37.44, lng: -122.16, label: 'Palo Alto' },
  { lat: 37.40, lng: -122.10, label: 'Mountain View' },
  { lat: 37.60, lng: -122.46, label: 'Pacifica' },
  { lat: 37.50, lng: -122.45, label: 'Half Moon Bay' },
  { lat: 37.55, lng: -122.42, label: 'Crystal Springs' },
]

export const fetchWindGrid = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: {
      date: string   // 'YYYY-MM-DD'
      hour: number   // 0-23
    }) => {
      if (!validateDate(input.date)) {
        throw new Error(`Invalid date format: ${input.date}`)
      }
      return {
        date: input.date,
        hour: clamp(Math.round(input.hour), 0, 23),
      }
    },
  )
  .handler(async ({ data }): Promise<WindGridPoint[]> => {
    const lats = WIND_GRID_POINTS.map((p) => p.lat.toFixed(4)).join(',')
    const lngs = WIND_GRID_POINTS.map((p) => p.lng.toFixed(4)).join(',')

    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', lats)
    url.searchParams.set('longitude', lngs)
    url.searchParams.set('hourly', 'windspeed_10m,winddirection_10m,windgusts_10m')
    url.searchParams.set('windspeed_unit', 'mph')
    url.searchParams.set('timezone', 'America/Los_Angeles')
    url.searchParams.set('forecast_days', '7')

    const response = await fetch(url.toString())
    if (!response.ok) {
      console.error(`[wind-grid] Open-Meteo API error: ${response.status}`)
      throw new Error('Failed to fetch wind grid data')
    }

    const apiData = await response.json()
    const locations: OpenMeteoForecastResponse[] = Array.isArray(apiData)
      ? apiData
      : [apiData]

    // Target time: combine date and hour
    const targetTime = new Date(`${data.date}T${String(data.hour).padStart(2, '0')}:00:00`)
    const targetMs = targetTime.getTime()

    return WIND_GRID_POINTS.map((point, i) => {
      const location = locations[Math.min(i, locations.length - 1)]
      const hourly = location.hourly

      if (!hourly?.time) {
        return { ...point, windSpeed: 0, windDirection: 0, windGusts: 0 }
      }

      // Find closest hour
      let closestIdx = 0
      let closestDiff = Infinity
      for (let j = 0; j < hourly.time.length; j++) {
        const diff = Math.abs(new Date(hourly.time[j]).getTime() - targetMs)
        if (diff < closestDiff) {
          closestDiff = diff
          closestIdx = j
        }
      }

      return {
        lat: point.lat,
        lng: point.lng,
        label: point.label,
        windSpeed: hourly.windspeed_10m?.[closestIdx] ?? 0,
        windDirection: hourly.winddirection_10m?.[closestIdx] ?? 0,
        windGusts: hourly.windgusts_10m?.[closestIdx] ?? 0,
      }
    })
  })

