/**
 * WeatherChart — Recharts composite chart showing weather along the route.
 *
 * Lines: Temperature, Wind Speed
 * Bars: Precipitation probability
 * Area: Cloud cover
 * ReferenceAreas: Dark period before sunrise
 */
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import type { RouteWeatherPoint } from '../server/forecast'

interface WeatherChartProps {
  waypoints: RouteWeatherPoint[]
  sunrise?: string
  departureTime?: Date
}

/** Compass direction from degrees */
function compassDir(deg: number): string {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ]
  return dirs[Math.round(deg / 22.5) % 16]
}

/**
 * Color for wind arrow based on headwind component.
 * Positive = headwind (red), negative = tailwind (green).
 */
function getWindEffectColor(headwind: number): string {
  if (headwind < -5) return '#22c55e'   // strong tailwind — green
  if (headwind < -2) return '#a3e635'   // light tailwind — lime
  if (headwind < 2)  return '#eab308'   // crosswind — yellow
  if (headwind < 5)  return '#f97316'   // light headwind — orange
  return '#ef4444'                       // strong headwind — red
}

/** Wind effect label */
function getWindEffectLabel(headwind: number): string {
  if (headwind < -5) return 'Tailwind'
  if (headwind < -2) return 'Quartering tailwind'
  if (headwind < 2)  return 'Crosswind'
  if (headwind < 5)  return 'Quartering headwind'
  return 'Headwind'
}

interface ChartDataPoint {
  label: string
  mile: number
  temperature: number
  windSpeed: number
  windDirection: number
  headwindComponent: number
  precipProb: number
  cloudCover: number
  estimatedArrival: string
}

/** Convert to minutes since midnight */
function toMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** Format minutes as "h:mm AM/PM" */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`
}

/** Custom tooltip */
function CustomTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; color: string; payload: ChartDataPoint }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0].payload
  const windEffect = getWindEffectLabel(data.headwindComponent)
  const windColor = getWindEffectColor(data.headwindComponent)

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 12px',
        fontSize: 'var(--text-sm)',
      }}
    >
      <p style={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
        {label}
      </p>
      {payload.map((entry) => {
        if (entry.dataKey === 'windSpeed') {
          return (
            <div key={entry.dataKey}>
              <p style={{ color: entry.color, margin: '2px 0' }}>
                Wind: {entry.value} mph from {compassDir(data.windDirection)}
              </p>
              <p style={{ color: windColor, margin: '2px 0', fontWeight: 600 }}>
                → {windEffect} ({Math.abs(data.headwindComponent)} mph component)
              </p>
            </div>
          )
        }
        if (entry.dataKey === 'temperature') {
          return (
            <p key={entry.dataKey} style={{ color: entry.color, margin: '2px 0' }}>
              Temp: {entry.value}°F
            </p>
          )
        }
        if (entry.dataKey === 'precipProb') {
          return (
            <p key={entry.dataKey} style={{ color: entry.color, margin: '2px 0' }}>
              Rain: {entry.value}%
            </p>
          )
        }
        if (entry.dataKey === 'cloudCover') {
          return (
            <p key={entry.dataKey} style={{ color: entry.color, margin: '2px 0' }}>
              Cloud: {entry.value}%
            </p>
          )
        }
        return null
      })}
    </div>
  )
}

export function WeatherChart({
  waypoints,
  sunrise,
  departureTime,
}: WeatherChartProps) {
  const chartData: ChartDataPoint[] = waypoints.map((wp) => ({
    label: wp.label,
    mile: wp.mile,
    temperature: Math.round(wp.temperature * 10) / 10,
    windSpeed: Math.round(wp.windSpeed * 10) / 10,
    windDirection: wp.windDirection,
    headwindComponent: wp.headwindComponent,
    precipProb: wp.precipProb,
    cloudCover: wp.cloudCover,
    estimatedArrival: wp.estimatedArrival,
  }))

  // Sunrise / dark period
  const sunriseMin = sunrise ? toMinutes(new Date(sunrise)) : 6 * 60
  const isDarkStart = departureTime ? toMinutes(departureTime) < sunriseMin : false

  let sunriseWaypointIdx = -1
  if (sunrise && isDarkStart && chartData.length > 0) {
    const sunriseMs = new Date(sunrise).getTime()
    for (let i = 0; i < chartData.length; i++) {
      const arrMs = new Date(chartData[i].estimatedArrival).getTime()
      if (arrMs >= sunriseMs) {
        sunriseWaypointIdx = i
        break
      }
    }
    if (sunriseWaypointIdx === -1) {
      sunriseWaypointIdx = chartData.length - 1
    }
  }

  const sunlightInfo = (() => {
    if (!sunrise) return null
    return {
      sunriseTime: formatTime(sunriseMin),
      isDarkStart,
    }
  })()

  return (
    <div className="forecast-chart">
      <div className="forecast-chart__header">
        <h3 className="forecast-chart__title">Weather Along Route</h3>
        {sunlightInfo && (
          <div className="forecast-chart__sunlight">
            <span className="forecast-chart__sun-badge">
              🌅 Sunrise {sunlightInfo.sunriseTime}
            </span>
            {sunlightInfo.isDarkStart && (
              <span className="forecast-chart__dark-warning">
                ⚠️ Starting in the dark — bring lights!
              </span>
            )}
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 60, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
          />

          {isDarkStart && sunriseWaypointIdx > 0 && (
            <ReferenceArea
              x1={chartData[0].label}
              x2={chartData[Math.min(sunriseWaypointIdx, chartData.length - 1)].label}
              yAxisId="left"
              fill="var(--color-dark-bar)"
              fillOpacity={0.08}
              strokeOpacity={0}
            />
          )}

          {sunriseWaypointIdx >= 0 && sunriseWaypointIdx < chartData.length && (
            <ReferenceLine
              x={chartData[sunriseWaypointIdx].label}
              yAxisId="left"
              stroke="var(--color-warning)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: '🌅',
                position: 'top',
                fontSize: 16,
              }}
            />
          )}

          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
            angle={-45}
            textAnchor="end"
            height={80}
            interval={0}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            label={{
              value: '°F / mph',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 11, fill: 'var(--color-text-muted)' },
            }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            label={{
              value: '%',
              angle: 90,
              position: 'insideRight',
              style: { fontSize: 11, fill: 'var(--color-text-muted)' },
            }}
          />
          <RechartsTooltip content={<CustomTooltipContent />} />
          <Legend
            wrapperStyle={{ fontSize: 'var(--text-xs)', paddingTop: '8px' }}
            verticalAlign="top"
          />

          <Area
            yAxisId="right"
            type="monotone"
            dataKey="cloudCover"
            name="Cloud %"
            fill="var(--color-text-muted)"
            fillOpacity={0.15}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />

          <Bar
            yAxisId="right"
            dataKey="precipProb"
            name="Rain %"
            fill="var(--color-info)"
            fillOpacity={0.5}
            radius={[2, 2, 0, 0]}
            barSize={16}
          />

          <Line
            yAxisId="left"
            type="monotone"
            dataKey="temperature"
            name="Temp (°F)"
            stroke="var(--color-sf2g-orange)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--color-sf2g-orange)' }}
            activeDot={{ r: 5 }}
          />

          <Line
            yAxisId="left"
            type="monotone"
            dataKey="windSpeed"
            name="Wind (mph)"
            stroke="var(--color-success)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={{ r: 3, fill: 'var(--color-success)' }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>


    </div>
  )
}
