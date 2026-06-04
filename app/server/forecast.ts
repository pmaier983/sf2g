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
      }
    })

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
      },
    }
  })
