/**
 * ProfileFunStats — Fun/insightful stats for a rider's profile page.
 *
 * Shows:
 * - SF2G commitment trend (cumulative % of rides that are SF2G over time)
 * - Everest counter (total elevation / 8,849m)
 * - Personal records (fastest, longest, most elevation)
 * - Streaks & day-of-week heatmap
 * - Fun comparisons (distance equivalents, time on bike)
 */
import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { Ride } from '../lib/database.types'
import { useUnit } from '../lib/useUnit'
import {
  formatDistance,
  formatElevation,
  formatSpeed,
  formatMovingTime,
} from '../lib/leaderboard-utils'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVEREST_HEIGHT_METERS = 8_849
const EARTH_CIRCUMFERENCE_KM = 40_075
const SF_TO_LA_KM = 616
const METERS_PER_KM = 1_000

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileFunStatsProps {
  rides: Ride[]
  /** Total number of ALL rides (including non-SF2G) for SF2G% calculation */
  totalAllRides?: number
}

interface MonthlyTrendPoint {
  month: string
  label: string
  cumulativeSf2g: number
  monthlyCount: number
}

interface PersonalRecord {
  label: string
  value: string
  rideName: string | null
  rideDate: string
  stravaId: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

/**
 * Get the best streak of consecutive weeks with at least one SF2G ride.
 */
function computeWeekStreak(rides: Ride[]): { current: number; best: number } {
  if (rides.length === 0) return { current: 0, best: 0 }

  // Map each ride to its ISO week key (YYYY-WW)
  const rideWeeks = new Set<string>()
  for (const ride of rides) {
    const date = new Date(ride.ride_date)
    const jan1 = new Date(date.getFullYear(), 0, 1)
    const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000)
    const weekNum = Math.ceil((dayOfYear + jan1.getDay() + 1) / 7)
    rideWeeks.add(`${date.getFullYear()}-${String(weekNum).padStart(2, '0')}`)
  }

  // Generate all weeks from first to last ride
  const sortedDates = rides
    .map((r) => new Date(r.ride_date))
    .sort((a, b) => a.getTime() - b.getTime())
  const firstDate = sortedDates[0]
  const lastDate = sortedDates[sortedDates.length - 1]

  let best = 0
  let current = 0
  const cursor = new Date(firstDate)
  // Align to Monday
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))

  while (cursor <= lastDate) {
    const jan1 = new Date(cursor.getFullYear(), 0, 1)
    const dayOfYear = Math.floor((cursor.getTime() - jan1.getTime()) / 86400000)
    const weekNum = Math.ceil((dayOfYear + jan1.getDay() + 1) / 7)
    const key = `${cursor.getFullYear()}-${String(weekNum).padStart(2, '0')}`

    if (rideWeeks.has(key)) {
      current++
      best = Math.max(best, current)
    } else {
      current = 0
    }
    cursor.setDate(cursor.getDate() + 7)
  }

  return { current, best }
}

/**
 * Compute the day-of-week distribution (0=Mon, 6=Sun).
 */
function computeDayDistribution(rides: Ride[]): number[] {
  const counts = new Array(7).fill(0) as number[]
  for (const ride of rides) {
    const date = new Date(ride.ride_date)
    // getDay: 0=Sun, shift to 0=Mon
    const dayIdx = (date.getDay() + 6) % 7
    counts[dayIdx]++
  }
  return counts
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function TrendTooltip({ active, payload, label }: TooltipProps<number, string>) {
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
      {payload.map((entry) => (
        <p
          key={entry.dataKey}
          style={{ color: entry.color, margin: '2px 0' }}
        >
          {entry.dataKey === 'cumulativeSf2g'
            ? `Total SF2G: ${entry.value}`
            : `This month: ${entry.value}`}
        </p>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfileFunStats({ rides }: ProfileFunStatsProps) {
  const unit = useUnit()

  const stats = useMemo(() => {
    if (rides.length === 0) return null

    const sortedRides = [...rides].sort(
      (a, b) => new Date(a.ride_date).getTime() - new Date(b.ride_date).getTime(),
    )

    // ── Monthly trend (cumulative SF2G rides) ──
    const monthlyMap = new Map<string, number>()
    for (const ride of sortedRides) {
      const month = ride.ride_date.slice(0, 7) // YYYY-MM
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + 1)
    }

    const sortedMonths = Array.from(monthlyMap.keys()).sort()
    let cumulative = 0
    const trendData: MonthlyTrendPoint[] = sortedMonths.map((month) => {
      const count = monthlyMap.get(month) ?? 0
      cumulative += count
      return {
        month,
        label: formatMonthLabel(month),
        cumulativeSf2g: cumulative,
        monthlyCount: count,
      }
    })

    // ── Elevation: Everest counter ──
    const totalElevation = rides.reduce(
      (sum, r) => sum + (r.elevation_gain_meters ?? 0),
      0,
    )
    const everests = totalElevation / EVEREST_HEIGHT_METERS

    // ── Distance equivalents ──
    const totalDistance = rides.reduce(
      (sum, r) => sum + (r.distance_meters ?? 0),
      0,
    )
    const totalDistanceKm = totalDistance / METERS_PER_KM
    const sfToLaTrips = totalDistanceKm / SF_TO_LA_KM
    const earthLaps = totalDistanceKm / EARTH_CIRCUMFERENCE_KM

    // ── Time on bike ──
    const totalMovingSeconds = rides.reduce(
      (sum, r) => sum + (r.moving_time_seconds ?? 0),
      0,
    )
    const totalHours = totalMovingSeconds / 3600

    // ── Personal records ──
    const prs: PersonalRecord[] = []

    // Fastest ride
    const fastestRide = rides.reduce<Ride | null>((best, r) => {
      if (r.average_speed_mps == null) return best
      if (!best || (r.average_speed_mps > (best.average_speed_mps ?? 0))) return r
      return best
    }, null)
    if (fastestRide) {
      prs.push({
        label: '⚡ Fastest Ride',
        value: formatSpeed(fastestRide.average_speed_mps ?? 0, unit),
        rideName: fastestRide.name,
        rideDate: fastestRide.ride_date,
        stravaId: fastestRide.strava_activity_id,
      })
    }

    // Longest ride
    const longestRide = rides.reduce<Ride | null>((best, r) => {
      if (r.distance_meters == null) return best
      if (!best || (r.distance_meters > (best.distance_meters ?? 0))) return r
      return best
    }, null)
    if (longestRide) {
      prs.push({
        label: '📏 Longest Ride',
        value: formatDistance(longestRide.distance_meters ?? 0, unit),
        rideName: longestRide.name,
        rideDate: longestRide.ride_date,
        stravaId: longestRide.strava_activity_id,
      })
    }

    // Most climbing
    const climbiest = rides.reduce<Ride | null>((best, r) => {
      if (r.elevation_gain_meters == null) return best
      if (!best || (r.elevation_gain_meters > (best.elevation_gain_meters ?? 0))) return r
      return best
    }, null)
    if (climbiest) {
      prs.push({
        label: '🏔️ Most Climbing',
        value: formatElevation(climbiest.elevation_gain_meters ?? 0, unit),
        rideName: climbiest.name,
        rideDate: climbiest.ride_date,
        stravaId: climbiest.strava_activity_id,
      })
    }

    // Longest ride (time)
    const longestTime = rides.reduce<Ride | null>((best, r) => {
      if (r.moving_time_seconds == null) return best
      if (!best || (r.moving_time_seconds > (best.moving_time_seconds ?? 0))) return r
      return best
    }, null)
    if (longestTime) {
      prs.push({
        label: '⏱️ Longest Time',
        value: formatMovingTime(longestTime.moving_time_seconds),
        rideName: longestTime.name,
        rideDate: longestTime.ride_date,
        stravaId: longestTime.strava_activity_id,
      })
    }

    // ── Streaks ──
    const streaks = computeWeekStreak(sortedRides)

    // ── Day distribution ──
    const dayDistribution = computeDayDistribution(sortedRides)
    const maxDayCount = Math.max(...dayDistribution)
    const favoriteDayIdx = dayDistribution.indexOf(maxDayCount)
    const favoriteDay = DAY_LABELS[favoriteDayIdx]

    // ── Early bird vs night owl ──
    let earlyCount = 0
    let lateCount = 0
    for (const ride of rides) {
      const hour = new Date(ride.start_date).getHours()
      if (hour < 9) earlyCount++
      else if (hour >= 16) lateCount++
    }

    return {
      trendData,
      everests,
      totalElevation,
      totalDistance,
      totalDistanceKm,
      sfToLaTrips,
      earthLaps,
      totalHours,
      totalMovingSeconds,
      prs,
      streaks,
      dayDistribution,
      maxDayCount,
      favoriteDay,
      earlyCount,
      lateCount,
      rideCount: rides.length,
    }
  }, [rides, unit])

  if (!stats) return null

  return (
    <div className="fun-stats">
      {/* ── SF2G Growth Trend ── */}
      <div className="fun-stats__section">
        <h3 className="fun-stats__section-title">📈 SF2G Commitment</h3>
        <div className="fun-stats__chart">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={stats.trendData}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <defs>
                <linearGradient id="sf2gGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-sf2g-orange)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-sf2g-orange)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                axisLine={{ stroke: 'var(--color-border)' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <RechartsTooltip content={<TrendTooltip />} />
              <Area
                type="monotone"
                dataKey="cumulativeSf2g"
                stroke="var(--color-sf2g-orange)"
                fill="url(#sf2gGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Fun Comparisons ── */}
      <div className="fun-stats__section">
        <h3 className="fun-stats__section-title">🏆 By the Numbers</h3>
        <div className="fun-stats__comparisons">
          {/* Everest */}
          <div className="fun-stats__comparison-card">
            <div className="fun-stats__comparison-icon">🏔️</div>
            <div className="fun-stats__comparison-value">
              {stats.everests.toFixed(1)}×
            </div>
            <div className="fun-stats__comparison-label">
              Everests climbed
            </div>
            <div className="fun-stats__comparison-detail">
              {formatElevation(stats.totalElevation, unit)} total
            </div>
          </div>

          {/* SF → LA trips */}
          <div className="fun-stats__comparison-card">
            <div className="fun-stats__comparison-icon">🚗</div>
            <div className="fun-stats__comparison-value">
              {stats.sfToLaTrips.toFixed(1)}×
            </div>
            <div className="fun-stats__comparison-label">
              SF→LA trips
            </div>
            <div className="fun-stats__comparison-detail">
              {formatDistance(stats.totalDistance, unit)} total
            </div>
          </div>

          {/* Time on bike */}
          <div className="fun-stats__comparison-card">
            <div className="fun-stats__comparison-icon">⏱️</div>
            <div className="fun-stats__comparison-value">
              {Math.round(stats.totalHours)}h
            </div>
            <div className="fun-stats__comparison-label">
              on the bike
            </div>
            <div className="fun-stats__comparison-detail">
              {(stats.totalHours / 24).toFixed(1)} full days
            </div>
          </div>

          {/* Earth laps */}
          {stats.earthLaps >= 0.01 && (
            <div className="fun-stats__comparison-card">
              <div className="fun-stats__comparison-icon">🌍</div>
              <div className="fun-stats__comparison-value">
                {stats.earthLaps >= 1
                  ? `${stats.earthLaps.toFixed(1)}×`
                  : `${(stats.earthLaps * 100).toFixed(0)}%`}
              </div>
              <div className="fun-stats__comparison-label">
                {stats.earthLaps >= 1 ? 'around Earth' : 'of Earth'}
              </div>
              <div className="fun-stats__comparison-detail">
                circumference
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Personal Records ── */}
      {stats.prs.length > 0 && (
        <div className="fun-stats__section">
          <h3 className="fun-stats__section-title">🥇 Personal Records</h3>
          <div className="fun-stats__prs">
            {stats.prs.map((pr) => (
              <a
                key={pr.label}
                href={`https://www.strava.com/activities/${pr.stravaId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="fun-stats__pr-card"
              >
                <div className="fun-stats__pr-label">{pr.label}</div>
                <div className="fun-stats__pr-value">{pr.value}</div>
                <div className="fun-stats__pr-ride">
                  {pr.rideName ?? 'Untitled'} ·{' '}
                  {new Date(pr.rideDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: '2-digit',
                  })}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Streaks & Patterns ── */}
      <div className="fun-stats__section">
        <h3 className="fun-stats__section-title">🔥 Streaks & Patterns</h3>
        <div className="fun-stats__patterns">
          {/* Week streak */}
          <div className="fun-stats__pattern-card">
            <div className="fun-stats__pattern-stat">
              <span className="fun-stats__pattern-value">
                {stats.streaks.best}
              </span>
              <span className="fun-stats__pattern-unit">weeks</span>
            </div>
            <div className="fun-stats__pattern-label">Best weekly streak</div>
            {stats.streaks.current > 0 && (
              <div className="fun-stats__pattern-detail">
                🔥 {stats.streaks.current} week{stats.streaks.current !== 1 ? 's' : ''} active now
              </div>
            )}
          </div>

          {/* Favorite day */}
          <div className="fun-stats__pattern-card">
            <div className="fun-stats__pattern-stat">
              <span className="fun-stats__pattern-value">
                {stats.favoriteDay}
              </span>
            </div>
            <div className="fun-stats__pattern-label">
              Favorite ride day ({stats.maxDayCount} rides)
            </div>
          </div>

          {/* Early bird vs night owl */}
          <div className="fun-stats__pattern-card">
            <div className="fun-stats__pattern-stat">
              <span className="fun-stats__pattern-value">
                {stats.earlyCount > stats.lateCount ? '🌅' : '🌙'}
              </span>
            </div>
            <div className="fun-stats__pattern-label">
              {stats.earlyCount > stats.lateCount
                ? `Early Bird — ${stats.earlyCount} pre-9am rides`
                : stats.lateCount > stats.earlyCount
                  ? `Night Owl — ${stats.lateCount} post-4pm rides`
                  : `Balanced — ${stats.earlyCount} morning, ${stats.lateCount} evening`}
            </div>
          </div>
        </div>

        {/* Day-of-week heatmap */}
        <div className="fun-stats__day-heatmap">
          {stats.dayDistribution.map((count, idx) => {
            const intensity =
              stats.maxDayCount > 0 ? count / stats.maxDayCount : 0
            return (
              <div key={DAY_LABELS[idx]} className="fun-stats__day-cell">
                <div
                  className="fun-stats__day-bar"
                  style={{
                    height: `${Math.max(4, intensity * 100)}%`,
                    opacity: Math.max(0.2, intensity),
                  }}
                />
                <span className="fun-stats__day-label">
                  {DAY_LABELS[idx]}
                </span>
                <span className="fun-stats__day-count">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
