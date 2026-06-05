/**
 * Should I SF2G? — Weather forecast page
 *
 * Gives riders weather intelligence for planning their SF2G commute.
 * Uses Open-Meteo Forecast API (free, no key needed).
 *
 * All input controls (date, route, departure, speed) are synced to URL
 * search params so shared links restore the exact forecast view.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useCallback } from 'react'
import { forecastQueryOptions } from '../queries/forecast'
import { ROUTE_LABELS, ROUTE_COLORS } from '../lib/constants'
import type { RouteCategory } from '../lib/database.types'
import { RideRecommendation } from '../components/RideRecommendation'
import { WeatherChart } from '../components/WeatherChart'
import { DecisionLogic } from '../components/DecisionLogic'
import '../styles/forecast.css'

// ---------------------------------------------------------------------------
// Search param types & defaults
// ---------------------------------------------------------------------------

/** Search params for the /should-i-sf2g route */
export interface ForecastSearch {
  date: string
  route: string
  departure: number
  speed: number
}

/** Routes available for forecasting */
const FORECAST_ROUTES: RouteCategory[] = ['bayway', 'skyline', 'hmbw', 'royale']

/** Get tomorrow's date as YYYY-MM-DD (default day for the forecast) */
function getTomorrowDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

const SEARCH_DEFAULTS: ForecastSearch = {
  date: getTomorrowDate(),
  route: 'skyline',
  departure: 6,
  speed: 17,
}

// ---------------------------------------------------------------------------
// Route definition with query param validation
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/should-i-sf2g')({
  validateSearch: (raw: Record<string, unknown>): ForecastSearch => {
    // Validate route — must be one of the 4 forecast routes
    const rawRoute = (raw.route as string) || SEARCH_DEFAULTS.route
    const route = FORECAST_ROUTES.includes(rawRoute as RouteCategory)
      ? rawRoute
      : SEARCH_DEFAULTS.route

    // Validate date — must be YYYY-MM-DD format
    const rawDate = (raw.date as string) || SEARCH_DEFAULTS.date
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : SEARCH_DEFAULTS.date

    // Validate departure — clamp to slider range [4, 9]
    const rawDeparture = Number(raw.departure)
    const departure =
      !isNaN(rawDeparture) && rawDeparture >= 4 && rawDeparture <= 9
        ? rawDeparture
        : SEARCH_DEFAULTS.departure

    // Validate speed — clamp to slider range [10, 25]
    const rawSpeed = Number(raw.speed)
    const speed =
      !isNaN(rawSpeed) && rawSpeed >= 10 && rawSpeed <= 25
        ? rawSpeed
        : SEARCH_DEFAULTS.speed

    return { date, route, departure, speed }
  },
  // Strip defaults to keep URLs clean (follows leaderboard pattern)
  search: {
    middlewares: [
      ({ search, next }) => {
        const out = { ...search } as Record<string, unknown>
        // Remove values that match defaults to keep shared links short
        for (const [key, def] of Object.entries(SEARCH_DEFAULTS)) {
          const val = out[key]
          const valEmpty = val === undefined || val === null || val === ''
          const defEmpty = def === undefined || def === null || def === ''
          if (val === def || (valEmpty && defEmpty)) {
            delete out[key]
          }
        }
        return next(out as unknown as typeof search)
      },
    ],
  },
  component: ShouldISf2gPage,
  head: () => ({
    meta: [
      { title: 'Should I SF2G? — Weather Forecast' },
      {
        name: 'description',
        content:
          'Check the weather along your SF2G commute route before you ride. Wind, rain, fog, and temperature forecast for Bayway, Skyline, HMBW, and Royale.',
      },
      // Open Graph tags for rich link previews
      { property: 'og:title', content: 'Should I SF2G? — Weather Forecast' },
      {
        property: 'og:description',
        content:
          'Weather intelligence for your SF2G commute. Check wind, rain, fog, and temperature before you ride.',
      },
      { property: 'og:type', content: 'website' },
      // Twitter card tags
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: 'Should I SF2G? — Weather Forecast' },
      {
        name: 'twitter:description',
        content:
          'Weather intelligence for your SF2G commute. Check wind, rain, fog, and temperature before you ride.',
      },
    ],
  }),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate day options: Today, Tomorrow, +2, +3, +4, +5, +6
 */
function getDayOptions(): Array<{ label: string; date: string; dayName: string }> {
  const options: Array<{ label: string; date: string; dayName: string }> = []
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    const dayName = dayNames[d.getDay()]

    let label: string
    if (i === 0) label = 'Today'
    else if (i === 1) label = 'Tomorrow'
    else label = dayName

    options.push({ label, date: dateStr, dayName })
  }
  return options
}

/**
 * Format departure hour (e.g. 5.5 → "5:30 AM", 6.75 → "6:45 AM")
 */
function formatDepartureHour(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ShouldISf2gPage() {
  const dayOptions = useMemo(() => getDayOptions(), [])

  // Read state from URL search params
  const {
    date: selectedDate,
    route: selectedRoute,
    departure: departureHour,
    speed: avgSpeed,
  } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  // Shared search param updater (follows leaderboard pattern)
  const updateSearch = useCallback(
    (patch: Partial<ForecastSearch>) =>
      navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate],
  )

  // Fetch forecast data
  const { data, isLoading, error } = useQuery(
    forecastQueryOptions({
      route: selectedRoute,
      date: selectedDate,
      departureHour,
      avgSpeedMph: avgSpeed,
    }),
  )

  // Compute departure time for sunlight timeline
  const departureTime = useMemo(() => {
    const dept = new Date(`${selectedDate}T00:00:00`)
    dept.setHours(Math.floor(departureHour))
    dept.setMinutes((departureHour % 1) * 60)
    return dept
  }, [selectedDate, departureHour])

  return (
    <div className="forecast-page animate-fade-in">
      {/* Header */}
      <div className="forecast-page__header">
        <h1 className="forecast-page__title">🌤️ Should I SF2G?</h1>
        <p className="forecast-page__subtitle">
          Weather intelligence for your commute
        </p>
      </div>

      {/* Input Controls */}
      <div className="forecast-inputs">
        {/* Day selector */}
        <div className="forecast-day-selector">
          <span className="forecast-day-selector__label">Day</span>
          <div className="forecast-day-selector__pills">
            {dayOptions.map((opt) => (
              <button
                key={opt.date}
                className={`forecast-day-pill${
                  selectedDate === opt.date ? ' forecast-day-pill--active' : ''
                }`}
                onClick={() => updateSearch({ date: opt.date })}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Route selector */}
        <div className="forecast-route-selector">
          <span className="forecast-route-selector__label">Route</span>
          <div className="forecast-route-selector__chips">
            {FORECAST_ROUTES.map((route) => (
              <button
                key={route}
                className={`forecast-route-chip${
                  selectedRoute === route ? ' forecast-route-chip--active' : ''
                }`}
                style={{
                  borderColor: ROUTE_COLORS[route],
                  ...(selectedRoute === route
                    ? { background: ROUTE_COLORS[route] }
                    : {}),
                }}
                onClick={() => updateSearch({ route })}
                type="button"
              >
                {ROUTE_LABELS[route]}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders row */}
        <div className="forecast-inputs__row">
          {/* Departure time slider */}
          <div className="forecast-slider">
            <label htmlFor="forecast-departure" className="forecast-slider__label">
              Departure
              <span className="forecast-slider__value">
                {formatDepartureHour(departureHour)}
              </span>
            </label>
            <input
              id="forecast-departure"
              type="range"
              className="forecast-slider__input"
              min={4}
              max={9}
              step={0.25}
              value={departureHour}
              onChange={(e) => updateSearch({ departure: Number(e.target.value) })}
            />
          </div>

          {/* Speed slider */}
          <div className="forecast-slider">
            <label htmlFor="forecast-avg-speed" className="forecast-slider__label">
              Avg Speed
              <span className="forecast-slider__value">{avgSpeed} mph</span>
            </label>
            <input
              id="forecast-avg-speed"
              type="range"
              className="forecast-slider__input"
              min={10}
              max={25}
              step={0.5}
              value={avgSpeed}
              onChange={(e) => updateSearch({ speed: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="forecast-loading">
          <div className="forecast-loading__spinner" />
          <p>Fetching weather forecast…</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="forecast-error">
          <p>Failed to load forecast.</p>
          <p className="text-muted">
            {error instanceof Error
              ? error.message
              : 'An unexpected error occurred.'}
          </p>
        </div>
      )}

      {/* Forecast data */}
      {data && (
        <>
          {/* YES / MAYBE / NO Recommendation (top of results) */}
          <RideRecommendation summary={data.summary} />

          {/* Weather Chart (with integrated wind direction) */}
          <WeatherChart
            waypoints={data.waypoints}
            sunrise={data.sunrise}
            departureTime={departureTime}
          />

          {/* Decision Logic (bottom) */}
          <DecisionLogic summary={data.summary} />
        </>
      )}
    </div>
  )
}
