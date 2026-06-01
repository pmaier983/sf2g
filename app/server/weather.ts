/**
 * Open-Meteo Archive API client for historical wind data.
 *
 * Server-only — uses native `fetch` to query the free Open-Meteo API.
 * Returns hourly wind data for a single day at a given location.
 * All errors are caught and return null for graceful degradation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HourlyWindData {
  wind_speed_ms: number
  wind_direction_deg: number
  wind_gust_ms: number
}

export interface DailyWindResponse {
  /** Hourly wind data keyed by hour (0–23) */
  hours: Map<number, HourlyWindData>
}

// ---------------------------------------------------------------------------
// Open-Meteo response shape (internal)
// ---------------------------------------------------------------------------

interface OpenMeteoHourlyResponse {
  hourly?: {
    time?: string[]
    wind_speed_10m?: number[]
    wind_direction_10m?: number[]
    wind_gusts_10m?: number[]
  }
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

const OPEN_METEO_BASE_URL = 'https://archive-api.open-meteo.com/v1/archive'

/**
 * Fetch a full day of hourly wind data from Open-Meteo Archive API.
 *
 * Returns all 24 hours so multiple rides on the same day can share
 * a single API call. Returns null on any error (graceful degradation).
 *
 * @param lat - Latitude of the location
 * @param lng - Longitude of the location
 * @param date - Date in YYYY-MM-DD format
 */
export async function fetchDailyWind(
  lat: number,
  lng: number,
  date: string,
): Promise<DailyWindResponse | null> {
  try {
    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return null
    }

    // Validate coordinate ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null
    }

    const url = new URL(OPEN_METEO_BASE_URL)
    url.searchParams.set('latitude', String(lat))
    url.searchParams.set('longitude', String(lng))
    url.searchParams.set('start_date', date)
    url.searchParams.set('end_date', date)
    url.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,wind_gusts_10m')
    url.searchParams.set('timezone', 'America/Los_Angeles')

    const response = await fetch(url.toString())

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as OpenMeteoHourlyResponse

    if (!data.hourly?.time || !data.hourly.wind_speed_10m || !data.hourly.wind_direction_10m) {
      return null
    }

    const hours = new Map<number, HourlyWindData>()

    for (let i = 0; i < data.hourly.time.length; i++) {
      // Open-Meteo returns times like "2024-03-15T00:00" in the requested timezone
      const timeStr = data.hourly.time[i]
      const hour = new Date(timeStr).getHours()

      const windSpeed = data.hourly.wind_speed_10m[i]
      const windDirection = data.hourly.wind_direction_10m[i]
      const windGust = data.hourly.wind_gusts_10m?.[i]

      if (windSpeed != null && windDirection != null) {
        hours.set(hour, {
          // Open-Meteo returns wind_speed_10m in km/h, convert to m/s
          wind_speed_ms: windSpeed / 3.6,
          wind_direction_deg: windDirection,
          wind_gust_ms: windGust != null ? windGust / 3.6 : 0,
        })
      }
    }

    return { hours }
  } catch {
    // Graceful degradation — wind data is non-critical
    return null
  }
}

/**
 * Extract wind data for a specific hour from a daily response.
 *
 * @param daily - The daily wind response from fetchDailyWind
 * @param hour - Hour of the day (0–23)
 * @returns Wind data for that hour, or null if not available
 */
export function getWindAtHour(
  daily: DailyWindResponse,
  hour: number,
): HourlyWindData | null {
  if (hour < 0 || hour > 23) {
    return null
  }
  return daily.hours.get(hour) ?? null
}
