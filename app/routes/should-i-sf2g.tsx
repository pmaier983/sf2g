/**
 * Should I SF2G? — Weather forecast page
 *
 * Gives riders weather intelligence for planning their SF2G commute.
 * Uses Open-Meteo Forecast API (free, no key needed).
 *
 * All input controls (date, route, departure, speed) are synced to URL
 * search params so shared links restore the exact forecast view.
 */
import { addDays, todayInLA, weekdayShort } from "../lib/dates";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useCallback, lazy, Suspense } from "react";
import { forecastQueryOptions } from "../queries/forecast";
import { ROUTE_LABELS, ROUTE_COLORS } from "../lib/constants";
import type { RouteCategory } from "../lib/database.types";
import { RideRecommendation } from "../components/RideRecommendation";
const WeatherChart = lazy(() =>
  import("../components/WeatherChart").then((m) => ({
    default: m.WeatherChart,
  })),
);
import { DecisionLogic } from "../components/DecisionLogic";
import "../styles/forecast.css";

// ---------------------------------------------------------------------------
// Search param types & defaults
// ---------------------------------------------------------------------------

/** Search params for the /should-i-sf2g route */
export interface ForecastSearch {
  /** YYYY-MM-DD; absent = tomorrow (resolved at render, in LA time). */
  date?: string;
  route: string;
  departure: number;
  speed: number;
}

/** Routes available for forecasting */
const FORECAST_ROUTES: RouteCategory[] = [
  "bayway",
  "skyline",
  "hmbw",
  "royale",
];

// No default date here: a module-level "tomorrow" is frozen when the Worker
// isolate starts. The page resolves a missing date to tomorrow in LA time.
const SEARCH_DEFAULTS = {
  route: "skyline",
  departure: 6,
  speed: 17,
};

// ---------------------------------------------------------------------------
// Route definition with query param validation
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/should-i-sf2g")({
  validateSearch: (raw: Record<string, unknown>): ForecastSearch => {
    // Validate route — must be one of the 4 forecast routes
    const rawRoute = (raw.route as string) || SEARCH_DEFAULTS.route;
    const route = FORECAST_ROUTES.includes(rawRoute as RouteCategory)
      ? rawRoute
      : SEARCH_DEFAULTS.route;

    // Validate date — must be YYYY-MM-DD format (absent = tomorrow)
    const rawDate = raw.date as string | undefined;
    const date =
      rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;

    // Validate departure — clamp to slider range [4, 9]
    const rawDeparture = Number(raw.departure);
    const departure =
      !isNaN(rawDeparture) && rawDeparture >= 4 && rawDeparture <= 9
        ? rawDeparture
        : SEARCH_DEFAULTS.departure;

    // Validate speed — clamp to slider range [10, 25]
    const rawSpeed = Number(raw.speed);
    const speed =
      !isNaN(rawSpeed) && rawSpeed >= 10 && rawSpeed <= 25
        ? rawSpeed
        : SEARCH_DEFAULTS.speed;

    return { date, route, departure, speed };
  },
  // Strip defaults to keep URLs clean
  search: {
    middlewares: [
      ({ search, next }) => {
        const out: Record<string, unknown> = { ...next(search) };
        for (const [k, v] of Object.entries(SEARCH_DEFAULTS)) {
          if (out[k] === v) delete out[k];
        }
        if (out.date === undefined) delete out.date;
        return out as unknown as ForecastSearch;
      },
    ],
  },
  component: ShouldISf2gPage,
  head: () => ({
    meta: [
      { title: "Should I SF2G? — Weather Forecast" },
      {
        name: "description",
        content:
          "Check the weather along your SF2G commute route before you ride. Rain, fog, and temperature forecast for Bayway, Skyline, HMBW, and Royale.",
      },
      // Open Graph tags for rich link previews
      { property: "og:title", content: "Should I SF2G? — Weather Forecast" },
      {
        property: "og:description",
        content:
          "Weather intelligence for your SF2G commute. Check rain, fog, and temperature before you ride.",
      },
      { property: "og:type", content: "website" },
      // Twitter card tags
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Should I SF2G? — Weather Forecast" },
      {
        name: "twitter:description",
        content:
          "Weather intelligence for your SF2G commute. Check rain, fog, and temperature before you ride.",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Day options: Today, Tomorrow, then weekday names — LA calendar days, so
 * the server render and every browser produce the same pills.
 */
function getDayOptions(today: string): Array<{
  label: string;
  date: string;
  dayName: string;
}> {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const dayName = weekdayShort(date);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayName;
    return { label, date, dayName };
  });
}

/**
 * Format departure hour (e.g. 5.5 → "5:30 AM", 6.75 → "6:45 AM")
 */
function formatDepartureHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ShouldISf2gPage() {
  const today = todayInLA();
  const dayOptions = useMemo(() => getDayOptions(today), [today]);

  // Read state from URL search params
  const {
    date: dateParam,
    route: selectedRoute,
    departure: departureHour,
    speed: avgSpeed,
  } = Route.useSearch();
  const selectedDate = dateParam ?? addDays(today, 1);
  const navigate = useNavigate({ from: Route.fullPath });

  // Shared search param updater (follows leaderboard pattern)
  const updateSearch = useCallback(
    (patch: Partial<ForecastSearch>) =>
      navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate],
  );

  // Fetch forecast data
  const { data, isLoading, error } = useQuery(
    forecastQueryOptions({
      route: selectedRoute,
      date: selectedDate,
      departureHour,
      avgSpeedMph: avgSpeed,
    }),
  );

  // Compute departure time for sunlight timeline
  const departureTime = useMemo(() => {
    const dept = new Date(`${selectedDate}T00:00:00`);
    dept.setHours(Math.floor(departureHour));
    dept.setMinutes((departureHour % 1) * 60);
    return dept;
  }, [selectedDate, departureHour]);

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
                  selectedDate === opt.date ? " forecast-day-pill--active" : ""
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
                  selectedRoute === route ? " forecast-route-chip--active" : ""
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
            <label
              htmlFor="forecast-departure"
              className="forecast-slider__label"
            >
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
              onChange={(e) =>
                updateSearch({ departure: Number(e.target.value) })
              }
            />
          </div>

          {/* Speed slider */}
          <div className="forecast-slider">
            <label
              htmlFor="forecast-avg-speed"
              className="forecast-slider__label"
            >
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
              : "An unexpected error occurred."}
          </p>
        </div>
      )}

      {/* Forecast data */}
      {data && (
        <>
          {/* YES / MAYBE / NO Recommendation (top of results) */}
          <RideRecommendation summary={data.summary} />

          {/* Weather Chart */}
          <Suspense fallback={<div className="chart-skeleton" />}>
            <WeatherChart
              waypoints={data.waypoints}
              sunrise={data.sunrise}
              departureTime={departureTime}
            />
          </Suspense>

          {/* Decision Logic (bottom) */}
          <DecisionLogic summary={data.summary} />
        </>
      )}
    </div>
  );
}
