/**
 * WeatherChart — Recharts composite chart showing weather along the route.
 *
 * Lines: Temperature, Wind Speed
 * Bars: Precipitation probability
 * Area: Cloud cover
 * X-axis: waypoint labels / miles
 * Y-axis: dual axes (temp/wind left, precip/cloud right)
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
} from 'recharts'
import type { RouteWeatherPoint } from '../server/forecast'

interface WeatherChartProps {
  waypoints: RouteWeatherPoint[]
}

interface ChartDataPoint {
  label: string
  mile: number
  temperature: number
  windSpeed: number
  precipProb: number
  cloudCover: number
}

export function WeatherChart({ waypoints }: WeatherChartProps) {
  const chartData: ChartDataPoint[] = waypoints.map((wp) => ({
    label: wp.label,
    mile: wp.mile,
    temperature: Math.round(wp.temperature * 10) / 10,
    windSpeed: Math.round(wp.windSpeed * 10) / 10,
    precipProb: wp.precipProb,
    cloudCover: wp.cloudCover,
  }))

  return (
    <div className="forecast-chart">
      <h3 className="forecast-chart__title">Weather Along Route</h3>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            angle={-35}
            textAnchor="end"
            height={70}
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
          <RechartsTooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)',
            }}
            labelStyle={{ color: 'var(--color-text)', fontWeight: 600 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 'var(--text-xs)' }}
          />

          {/* Cloud cover as area (background) */}
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

          {/* Precip probability as bars */}
          <Bar
            yAxisId="right"
            dataKey="precipProb"
            name="Rain %"
            fill="var(--color-info)"
            fillOpacity={0.5}
            radius={[2, 2, 0, 0]}
            barSize={16}
          />

          {/* Temperature line */}
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

          {/* Wind speed line */}
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
