import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { GroupRideDetailRider } from '../server/group-rides'
import { RIDER_COLORS } from '../lib/constants'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GroupRideOffsetChartProps {
  riders: GroupRideDetailRider[]
  currentTime: number // seconds from earliest start, synced with map
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

const DEG_TO_RAD = Math.PI / 180
const EARTH_RADIUS_M = 6_371_000

/** Haversine distance in meters between two lat/lng pairs. */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD
  const dLng = (lng2 - lng1) * DEG_TO_RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Compute bearing from point A to point B in radians.
 * Used to project rider offsets along the route direction.
 */
function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLng = (lng2 - lng1) * DEG_TO_RAD
  const y = Math.sin(dLng) * Math.cos(lat2 * DEG_TO_RAD)
  const x =
    Math.cos(lat1 * DEG_TO_RAD) * Math.sin(lat2 * DEG_TO_RAD) -
    Math.sin(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.cos(dLng)
  return Math.atan2(y, x)
}

/**
 * Signed distance (meters) of a rider relative to the centroid along
 * the group's direction of travel.  Positive = ahead, negative = behind.
 */
function signedOffsetAlongRoute(
  riderLat: number,
  riderLng: number,
  centroidLat: number,
  centroidLng: number,
  routeBearing: number,
): number {
  const dist = haversineDistance(centroidLat, centroidLng, riderLat, riderLng)
  const riderBearing = bearing(centroidLat, centroidLng, riderLat, riderLng)
  // dot-product projection onto route direction
  return dist * Math.cos(riderBearing - routeBearing)
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Given a rider's latlng stream and time stream, interpolate the lat/lng
 * at a specific elapsed time (seconds).  Returns null if the time is out
 * of range.
 */
function interpolatePosition(
  latlng: [number, number][],
  time: number[],
  targetTime: number,
): [number, number] | null {
  if (time.length === 0) return null
  if (targetTime < time[0] || targetTime > time[time.length - 1]) return null

  // Binary-search for the surrounding indices
  let lo = 0
  let hi = time.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (time[mid] <= targetTime) lo = mid
    else hi = mid
  }

  if (lo === hi || time[lo] === time[hi]) return latlng[lo]

  const t = (targetTime - time[lo]) / (time[hi] - time[lo])
  return [
    latlng[lo][0] + t * (latlng[hi][0] - latlng[lo][0]),
    latlng[lo][1] + t * (latlng[hi][1] - latlng[lo][1]),
  ]
}

// ---------------------------------------------------------------------------
// Data preparation
// ---------------------------------------------------------------------------

const SAMPLE_INTERVAL_S = 30 // seconds between samples

interface OffsetDataPoint {
  time: number // elapsed seconds
  label: string // formatted HH:MM
  [riderKey: string]: number | string
}

function buildOffsetData(
  riders: GroupRideDetailRider[],
): {
  data: OffsetDataPoint[]
  riderIds: string[]
  riderNameMap: Map<string, string>
  riderColorMap: Map<string, string>
} {
  // Only riders with valid streams
  const validRiders = riders.filter(
    (r) => r.streams && r.streams.latlng.length > 0 && r.streams.time.length > 0,
  )

  if (validRiders.length === 0) {
    return { data: [], riderIds: [], riderNameMap: new Map(), riderColorMap: new Map() }
  }

  // Build maps
  const riderIds = validRiders.map((r) => r.userId)
  const riderNameMap = new Map<string, string>()
  const riderColorMap = new Map<string, string>()
  validRiders.forEach((r, i) => {
    riderNameMap.set(r.userId, r.displayName)
    riderColorMap.set(r.userId, RIDER_COLORS[i % RIDER_COLORS.length])
  })

  // Determine global time range — use the intersection of all riders' time spans
  // so every sample has all riders active
  const earliest = Math.max(...validRiders.map((r) => r.streams!.time[0]))
  const latest = Math.min(
    ...validRiders.map((r) => r.streams!.time[r.streams!.time.length - 1]),
  )

  if (latest <= earliest) {
    return { data: [], riderIds, riderNameMap, riderColorMap }
  }

  // Compute average group speed (m/s) from the first valid rider's total
  // distance / time.  Used to convert distance offsets → time offsets.
  let totalDistanceM = 0
  const refRider = validRiders[0]
  const refLL = refRider.streams!.latlng
  for (let i = 1; i < refLL.length; i++) {
    totalDistanceM += haversineDistance(
      refLL[i - 1][0],
      refLL[i - 1][1],
      refLL[i][0],
      refLL[i][1],
    )
  }
  const refTime = refRider.streams!.time
  const totalTimeS = refTime[refTime.length - 1] - refTime[0]
  const avgSpeedMps = totalTimeS > 0 ? totalDistanceM / totalTimeS : 5 // fallback ~5 m/s

  // Sample at fixed intervals
  const data: OffsetDataPoint[] = []

  for (let t = earliest; t <= latest; t += SAMPLE_INTERVAL_S) {
    // Collect positions for all riders at time t
    const positions: { userId: string; lat: number; lng: number }[] = []
    for (const rider of validRiders) {
      const pos = interpolatePosition(
        rider.streams!.latlng,
        rider.streams!.time,
        t,
      )
      if (pos) {
        positions.push({ userId: rider.userId, lat: pos[0], lng: pos[1] })
      }
    }

    if (positions.length < 2) continue

    // Compute centroid
    const centroidLat =
      positions.reduce((sum, p) => sum + p.lat, 0) / positions.length
    const centroidLng =
      positions.reduce((sum, p) => sum + p.lng, 0) / positions.length

    // Determine route bearing from the centroid to a slightly future centroid
    const futureT = Math.min(t + SAMPLE_INTERVAL_S, latest)
    let routeBearingRad = 0

    if (futureT > t) {
      const futurePositions: [number, number][] = []
      for (const rider of validRiders) {
        const pos = interpolatePosition(
          rider.streams!.latlng,
          rider.streams!.time,
          futureT,
        )
        if (pos) futurePositions.push(pos)
      }
      if (futurePositions.length > 0) {
        const futureCentroidLat =
          futurePositions.reduce((s, p) => s + p[0], 0) / futurePositions.length
        const futureCentroidLng =
          futurePositions.reduce((s, p) => s + p[1], 0) / futurePositions.length
        routeBearingRad = bearing(
          centroidLat,
          centroidLng,
          futureCentroidLat,
          futureCentroidLng,
        )
      }
    }

    // Compute each rider's signed offset in seconds
    const elapsedMinutes = Math.floor((t - earliest) / 60)
    const hours = Math.floor(elapsedMinutes / 60)
    const mins = elapsedMinutes % 60
    const label = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`

    const point: OffsetDataPoint = { time: t - earliest, label }

    for (const pos of positions) {
      const distanceM = signedOffsetAlongRoute(
        pos.lat,
        pos.lng,
        centroidLat,
        centroidLng,
        routeBearingRad,
      )
      // Convert meters → seconds offset using average speed
      const offsetSeconds = avgSpeedMps > 0 ? distanceM / avgSpeedMps : 0
      point[pos.userId] = Math.round(offsetSeconds * 10) / 10
    }

    data.push(point)
  }

  return { data, riderIds, riderNameMap, riderColorMap }
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function OffsetTooltip({
  active,
  payload,
  label,
  riderNameMap,
}: TooltipProps<number, string> & { riderNameMap: Map<string, string> }) {
  if (!active || !payload?.length) return null

  return (
    <div
      style={{
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text)',
        padding: '8px 12px',
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {payload.map((entry) => {
        const val = typeof entry.value === 'number' ? entry.value : 0
        const sign = val > 0 ? '+' : ''
        return (
          <p
            key={entry.dataKey}
            style={{ color: entry.color, margin: '2px 0' }}
          >
            {riderNameMap.get(String(entry.dataKey)) ?? entry.dataKey}:{' '}
            {sign}{val.toFixed(1)}s
          </p>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupRideOffsetChart({
  riders,
  currentTime,
}: GroupRideOffsetChartProps) {
  const { data, riderIds, riderNameMap, riderColorMap } = useMemo(
    () => buildOffsetData(riders),
    [riders],
  )

  if (data.length === 0) {
    return (
      <div className="group-ride-offset-chart">
        <h3 className="group-ride-offset-chart__title">Rider Offsets</h3>
        <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
          <div className="empty-state__icon">📊</div>
          <h3 className="empty-state__title">No offset data</h3>
          <p className="empty-state__description">
            Stream data is needed to compute rider offsets.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="group-ride-offset-chart">
      <h3 className="group-ride-offset-chart__title">Rider Offsets</h3>

      <div className="group-ride-offset-chart__container">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={30}
            />
            <YAxis
              tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}s`}
              domain={['auto', 'auto']}
            />

            {/* Zero reference line */}
            <ReferenceLine
              y={0}
              stroke="var(--color-text-muted)"
              strokeDasharray="6 3"
              strokeWidth={1}
            />

            {/* Current time indicator */}
            <ReferenceLine
              x={(() => {
                // Find the closest label to the currentTime
                if (data.length === 0) return undefined
                let closest = data[0]
                let minDiff = Math.abs(data[0].time - currentTime)
                for (const point of data) {
                  const diff = Math.abs(
                    (typeof point.time === 'number' ? point.time : 0) -
                      currentTime,
                  )
                  if (diff < minDiff) {
                    minDiff = diff
                    closest = point
                  }
                }
                return closest.label
              })()}
              stroke="var(--color-sf2g-orange)"
              strokeWidth={2}
              strokeDasharray="4 2"
            />

            <RechartsTooltip
              content={(props: TooltipProps<number, string>) => (
                <OffsetTooltip {...props} riderNameMap={riderNameMap} />
              )}
            />

            {riderIds.map((riderId) => (
              <Line
                key={riderId}
                type="monotone"
                dataKey={riderId}
                name={riderId}
                stroke={riderColorMap.get(riderId) ?? 'var(--color-text-muted)'}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend with rider avatars and names */}
      <div className="group-ride-offset-chart__legend">
        {riders
          .filter((r) => riderIds.includes(r.userId))
          .map((rider) => {
            const color =
              riderColorMap.get(rider.userId) ?? 'var(--color-text-muted)'
            return (
              <div
                key={rider.userId}
                className="group-ride-offset-chart__legend-item"
              >
                {rider.avatarUrl ? (
                  <img
                    src={rider.avatarUrl}
                    alt={rider.displayName}
                    className="group-ride-offset-chart__legend-avatar"
                  />
                ) : (
                  <span
                    className="group-ride-offset-chart__legend-dot"
                    style={{ background: color }}
                  />
                )}
                <span
                  className="group-ride-offset-chart__legend-name"
                  style={{ color }}
                >
                  {rider.displayName}
                </span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
