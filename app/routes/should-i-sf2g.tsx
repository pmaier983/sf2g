/**
 * Should I SF2G? — Weather forecast page
 *
 * Gives riders weather intelligence for planning their SF2G commute.
 * Uses Open-Meteo Forecast API (free, no key needed).
 */
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { forecastQueryOptions } from '../queries/forecast'
import { ROUTE_LABELS, ROUTE_COLORS } from '../lib/constants'
import type { RouteCategory } from '../lib/database.types'
import { RideSummaryCards } from '../components/RideSummaryCards'
import { WeatherChart } from '../components/WeatherChart'
import { SunlightTimeline } from '../components/SunlightTimeline'
import { WindProfile } from '../components/WindProfile'
import '../styles/forecast.css'

export const Route = createFileRoute('/should-i-sf2g')({
  component: ShouldISf2gPage,
  head: () => ({
    meta: [
      { title: 'Should I SF2G? — Weather Forecast' },
      {
        name: 'description',
        content:
          'Check the weather along your SF2G commute route before you ride. Temperature, wind, precipitation, and sunrise data.',
      },
    ],
  }),
})

/** Routes available for forecasting */
const FORECAST_ROUTES: RouteCategory[] = ['bayway', 'skyline', 'hmbw', 'royale']

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

function ShouldISf2gPage() {
  const dayOptions = useMemo(() => getDayOptions(), [])

  // State for input controls
  const [selectedDate, setSelectedDate] = useState(dayOptions[0].date)
  const [selectedRoute, setSelectedRoute] = useState<string>('bayway')
  const [departureHour, setDepartureHour] = useState(6) // 6:00 AM
  const [avgSpeed, setAvgSpeed] = useState(17) // 17 mph

  // Fetch forecast data
  const { data, isLoading, error } = useQuery(
    forecastQueryOptions({
      route: selectedRoute,
      date: selectedDate,
      departureHour,
      avgSpeedMph: avgSpeed,
    }),
  )

  // Compute departure and arrival times for sunlight timeline
  const { departureTime, arrivalTime } = useMemo(() => {
    const dept = new Date(`${selectedDate}T00:00:00`)
    dept.setHours(Math.floor(departureHour))
    dept.setMinutes((departureHour % 1) * 60)

    // Use last waypoint time from data, or estimate
    let arrMs: number
    if (data?.waypoints && data.waypoints.length > 0) {
      const lastWp = data.waypoints[data.waypoints.length - 1]
      arrMs = new Date(lastWp.estimatedArrival).getTime()
    } else {
      // Estimate: ~30 miles at avg speed
      const routeMiles = selectedRoute === 'hmbw' ? 35 : 30
      arrMs = dept.getTime() + (routeMiles / avgSpeed) * 3600_000
    }

    return {
      departureTime: dept,
      arrivalTime: new Date(arrMs),
    }
  }, [selectedDate, departureHour, avgSpeed, data, selectedRoute])

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
                onClick={() => setSelectedDate(opt.date)}
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
                onClick={() => setSelectedRoute(route)}
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
            <label className="forecast-slider__label">
              Departure
              <span className="forecast-slider__value">
                {formatDepartureHour(departureHour)}
              </span>
            </label>
            <input
              type="range"
              className="forecast-slider__input"
              min={4}
              max={9}
              step={0.25}
              value={departureHour}
              onChange={(e) => setDepartureHour(Number(e.target.value))}
            />
          </div>

          {/* Speed slider */}
          <div className="forecast-slider">
            <label className="forecast-slider__label">
              Avg Speed
              <span className="forecast-slider__value">{avgSpeed} mph</span>
            </label>
            <input
              type="range"
              className="forecast-slider__input"
              min={10}
              max={25}
              step={0.5}
              value={avgSpeed}
              onChange={(e) => setAvgSpeed(Number(e.target.value))}
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
          {/* Weather description badge */}
          <div className="forecast-description">
            <span>Conditions:</span>
            <span className="forecast-description__badge">
              {data.summary.weatherDescription}
            </span>
            {data.summary.maxPrecipProb > 0 && (
              <span>
                · Max rain chance: {data.summary.maxPrecipProb}%
              </span>
            )}
          </div>

          {/* Summary Cards */}
          <RideSummaryCards summary={data.summary} />

          {/* Weather Chart */}
          <WeatherChart waypoints={data.waypoints} />

          {/* Sunlight Timeline */}
          <SunlightTimeline
            sunrise={data.sunrise}
            sunset={data.sunset}
            departureTime={departureTime}
            arrivalTime={arrivalTime}
          />

          {/* Wind Profile */}
          <WindProfile waypoints={data.waypoints} />
        </>
      )}
    </div>
  )
}
