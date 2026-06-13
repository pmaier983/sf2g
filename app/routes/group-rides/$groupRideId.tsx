/**
 * Group Ride detail page — /group-rides/:groupRideId
 *
 * Shows an animated map replay, offset chart, and comparison table
 * for a group ride. Streams are lazily fetched from Strava on first view.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useCallback, useEffect, useRef } from 'react'
import { groupRideDetailQueryOptions } from '../../queries/group-rides'
import { GroupRideMap } from '../../components/GroupRideMap'
import { GroupRideOffsetChart } from '../../components/GroupRideOffsetChart'
import { GroupRideComparisonTable } from '../../components/GroupRideComparisonTable'
import { toast } from '../../components/Toast'
import { RIDER_COLORS } from '../../lib/constants'
import type { RouteCategory } from '../../lib/database.types'
import type { GroupRideDetailRider, StreamFetchError } from '../../server/group-rides'

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

interface GroupRideSearch {
  date: string
  route: RouteCategory
  riders: string // comma-separated rider IDs
}

export const Route = createFileRoute('/group-rides/$groupRideId')({
  validateSearch: (raw: Record<string, unknown>): GroupRideSearch => ({
    date: (raw.date as string) || '',
    route: (raw.route as RouteCategory) || 'bayway',
    riders: (raw.riders as string) || '',
  }),
  component: GroupRideDetailPage,
  head: () => ({
    meta: [
      { title: 'Group Ride — SF2G' },
      {
        name: 'description',
        content: 'Group ride details and replay',
      },
    ],
  }),
})

// ---------------------------------------------------------------------------
// Speed options for playback
// ---------------------------------------------------------------------------

const SPEED_OPTIONS = [1, 2, 5, 10] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GroupRideDetailPage() {
  const { groupRideId } = Route.useParams()
  const { date, route, riders: ridersParam } = Route.useSearch()
  const riderIds = ridersParam ? ridersParam.split(',').filter(Boolean) : []

  // Query for group ride detail (lazy-fetches streams)
  const { data, isLoading, error } = useQuery(
    groupRideDetailQueryOptions({
      id: groupRideId,
      date,
      route,
      riderIds,
    }),
  )

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [speed, setSpeed] = useState<number>(1)
  const animationRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number>(0)

  // Compute total duration from rider streams
  const totalDuration = data?.riders.reduce((max: number, rider) => {
    if (!rider.streams) return max
    const riderStart = new Date(rider.ride.start_date).getTime()
    const earliestStart = data.riders.reduce((earliest: number, r) => {
      const t = new Date(r.ride.start_date).getTime()
      return t < earliest ? t : earliest
    }, Infinity)
    const offset = (riderStart - earliestStart) / 1000
    const riderEnd = offset + (rider.streams.time[rider.streams.time.length - 1] ?? 0)
    return Math.max(max, riderEnd)
  }, 0) ?? 0

  // Animation loop
  useEffect(() => {
    if (!isPlaying || totalDuration === 0) return

    const animate = (timestamp: number) => {
      if (lastFrameRef.current === 0) lastFrameRef.current = timestamp

      const delta = (timestamp - lastFrameRef.current) / 1000 // seconds
      lastFrameRef.current = timestamp

      setCurrentTime((prev) => {
        const next = prev + delta * speed
        if (next >= totalDuration) {
          setIsPlaying(false)
          return totalDuration
        }
        return next
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    lastFrameRef.current = 0
    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [isPlaying, speed, totalDuration])

  // Show toasts for stream errors
  useEffect(() => {
    if (!data?.streamErrors.length) return

    for (const err of data.streamErrors) {
      switch (err.type) {
        case 'RATE_LIMITED_DAILY':
          toast.error('Daily Strava limit reached', {
            description: 'The daily API limit (1,000 requests) has been hit. Cached streams are still available. Try again tomorrow.',
          })
          return // Show only the most severe toast
        case 'RATE_LIMITED_15MIN':
          toast.warning('Strava rate limit reached', {
            description: 'Too many requests in the last 15 minutes. Try again in ~15 min. Streams already fetched are cached.',
          })
          return
        case 'REAUTH_REQUIRED':
          toast.info('Stream unavailable', {
            description: `${err.displayName} needs to re-login to Strava to share ride data.`,
          })
          break
        case 'PRIVATE_ACTIVITY':
        case 'FETCH_ERROR':
          // Less critical — don't toast for each one
          break
      }
    }

    // Summary toast for partial data
    const ridersWithStreams = data.riders.filter((r: GroupRideDetailRider) => r.streams).length
    const totalRiders = data.riders.length
    if (ridersWithStreams > 0 && ridersWithStreams < totalRiders) {
      toast.warning('Partial data loaded', {
        description: `${ridersWithStreams} of ${totalRiders} rider streams loaded. Showing available data — try again later for the rest.`,
      })
    }
  }, [data?.streamErrors, data?.riders])

  const handlePlayPause = useCallback(() => {
    if (currentTime >= totalDuration) {
      setCurrentTime(0)
      setIsPlaying(true)
    } else {
      setIsPlaying((prev) => !prev)
    }
  }, [currentTime, totalDuration])

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    setCurrentTime(value)
    setIsPlaying(false)
  }, [])

  const formatPlaybackTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  // Rider colors
  const riderColors = data?.riders.map((_: GroupRideDetailRider, i: number) => RIDER_COLORS[i % RIDER_COLORS.length]) ?? []

  // Loading state
  if (isLoading) {
    return (
      <div className="group-ride-detail">
        <div className="group-ride-detail__loading">
          <div className="group-ride-detail__loading-spinner" />
          <p>Loading group ride data...</p>
          <p style={{ fontSize: 'var(--text-xs)' }}>
            Fetching ride streams from Strava (this may take a moment for first views)
          </p>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !data) {
    return (
      <div className="group-ride-detail">
        <Link to="/leaderboard" search={{ routes: [], search: '', ppr: false, other: false, weekends: true, company: undefined, user: undefined, view: 'groups' as const, duration: '1y', chart: false, sort: 'sf2g_total', dir: 'desc' as const, rSort: 'ride_date', rDir: 'desc' as const, page: 1, dateFrom: undefined, dateTo: undefined, datePreset: undefined, density: 'condensed' as const, reverse: false, gSort: 'date', gDir: 'desc' as const, gPage: 1 }} className="group-ride-detail__back">
          ← Back to Group Rides
        </Link>
        <div className="group-ride-detail__loading">
          <p>Failed to load group ride data.</p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #ef4444)' }}>
            {error?.message ?? 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }

  const formattedDate = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const routeLabel = data.routeCategory.charAt(0).toUpperCase() + data.routeCategory.slice(1)
  const hasStreams = data.riders.some((r) => r.streams)

  return (
    <div className="group-ride-detail">
      {/* Header */}
      <div className="group-ride-detail__header">
        <Link to="/leaderboard" search={{ routes: [], search: '', ppr: false, other: false, weekends: true, company: undefined, user: undefined, view: 'groups' as const, duration: '1y', chart: false, sort: 'sf2g_total', dir: 'desc' as const, rSort: 'ride_date', rDir: 'desc' as const, page: 1, dateFrom: undefined, dateTo: undefined, datePreset: undefined, density: 'condensed' as const, reverse: false, gSort: 'date', gDir: 'desc' as const, gPage: 1 }} className="group-ride-detail__back">
          ← Back to Group Rides
        </Link>
        <h1 className="group-ride-detail__title">
          Group Ride — {routeLabel}
        </h1>
        <p className="group-ride-detail__subtitle">{formattedDate}</p>

        {/* Rider chips */}
        <div className="group-ride-detail__riders">
          {data.riders.map((rider: GroupRideDetailRider, i: number) => (
            <div key={rider.userId} className="rider-chip">
              <div
                className="rider-chip__avatar"
                style={{ borderColor: riderColors[i] }}
              >
                {rider.avatarUrl ? (
                  <img src={rider.avatarUrl} alt={rider.displayName} />
                ) : (
                  <div className="rider-chip__avatar--fallback">
                    {rider.displayName.charAt(0)}
                  </div>
                )}
              </div>
              {rider.displayName}
              {!rider.streams && <span style={{ opacity: 0.5 }}> (no stream)</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Stream error banners */}
      {data.streamErrors.length > 0 && data.streamErrors.some((e: StreamFetchError) => e.type === 'RATE_LIMITED_DAILY') && (
        <div className="group-ride-detail__stream-banner group-ride-detail__stream-banner--error">
          ⚠️ Daily Strava API limit reached. Some ride streams could not be loaded. Try again tomorrow.
        </div>
      )}

      {/* Map + Chart */}
      {hasStreams && (
        <>
          <div className="group-ride-detail__content">
            <GroupRideMap
              riders={data.riders}
              currentTime={currentTime}
              isPlaying={isPlaying}
            />
            <GroupRideOffsetChart
              riders={data.riders}
              currentTime={currentTime}
            />
          </div>

          {/* Playback Controls */}
          <div className="group-ride-playback">
            <button
              type="button"
              className="group-ride-playback__play-btn"
              onClick={handlePlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>

            <div className="group-ride-playback__speed-btns">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`group-ride-playback__speed-btn${speed === s ? ' group-ride-playback__speed-btn--active' : ''}`}
                  onClick={() => setSpeed(s)}
                >
                  {s}x
                </button>
              ))}
            </div>

            <input
              type="range"
              className="group-ride-playback__scrubber"
              min={0}
              max={totalDuration}
              step={1}
              value={currentTime}
              onChange={handleScrub}
              aria-label="Playback position"
            />

            <span className="group-ride-playback__time">
              {formatPlaybackTime(currentTime)} / {formatPlaybackTime(totalDuration)}
            </span>
          </div>
        </>
      )}

      {/* No streams fallback */}
      {!hasStreams && (
        <div className="group-ride-detail__stream-banner">
          No stream data available for this group ride. Streams are fetched from Strava on first view.
        </div>
      )}

      {/* Comparison Table */}
      <GroupRideComparisonTable
        riders={data.riders}
        riderColors={riderColors}
      />
    </div>
  )
}
