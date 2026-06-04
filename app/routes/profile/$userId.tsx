import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { userRidesQueryOptions } from '../../queries/rides'
import { fetchUserProfile } from '../../server/users'
import { disconnectStrava } from '../../server/auth'
import { currentUserQueryOptions } from '../../queries/user'
import { RideFrequencyChart } from '../../components/RideFrequencyChart'
import { ProfileRideStats } from '../../components/ProfileRideStats'
import { ProfileFunStats } from '../../components/ProfileFunStats'
import { ProfileRidesTable } from '../../components/ProfileRidesTable'
import type { User } from '../../lib/database.types'
import { useState, useEffect, useCallback } from 'react'
import { useUnit } from '../../lib/useUnit'
import { formatDistance, formatElevation, formatSpeed, formatMovingTime } from '../../lib/leaderboard-utils'
import { toast } from '../../components/Toast'

export const Route = createFileRoute('/profile/$userId')({
  component: ProfilePage,
})

function ProfilePage() {
  const { userId } = Route.useParams()
  const { data: currentUser } = useQuery(currentUserQueryOptions())
  const [profile, setProfile] = useState<User | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const unit = useUnit()
  const isOwnProfile = currentUser?.id === userId

  const {
    data: rides,
    isLoading: ridesLoading,
  } = useQuery(userRidesQueryOptions(userId))

  const handleDisconnectStrava = async () => {
    setDisconnecting(true)
    try {
      const result = await disconnectStrava()
      if (result.redirectTo) {
        window.location.href = result.redirectTo
      }
    } catch {
      setDisconnecting(false)
      setShowDisconnectConfirm(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      try {
        const user = await fetchUserProfile({ data: { userId } })
        if (!cancelled) {
          setProfile(user)
          setProfileLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setProfileError(
            err instanceof Error ? err.message : 'Failed to load profile',
          )
          setProfileLoading(false)
        }
      }
    }

    loadProfile()
    return () => {
      cancelled = true
    }
  }, [userId])

  // Compute values needed by hooks (safe even when profile/rides are null)
  const totalRides = rides?.length ?? 0
  const totalDistanceMeters = rides
    ? rides.reduce((sum, r) => sum + (r.distance_meters ?? 0), 0)
    : 0

  const currentYear = new Date().getFullYear()
  const ytdRides = rides
    ? rides.filter(
        (r) => new Date(r.ride_date).getUTCFullYear() === currentYear,
      )
    : []
  const ytdRideCount = ytdRides.length
  const ytdDistanceMeters = ytdRides.reduce(
    (sum, r) => sum + (r.distance_meters ?? 0),
    0,
  )

  const displayName = profile?.display_name ?? profile?.username ?? 'Anonymous'
  const profileUrl = `https://sf2ging.com/profile/${userId}`

  // All hooks must be called before any early returns
  const handleShareLink = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${displayName} on SF2G`,
          url: profileUrl,
        })
      } catch {
        // User cancelled share — ignore
      }
    } else {
      await navigator.clipboard.writeText(profileUrl)
      toast.success('Profile link copied!')
    }
  }, [displayName, profileUrl])

  const handleShareStats = useCallback(async () => {
    // Compute some fun stats for the text
    const totalElevation = rides
      ? rides.reduce((sum, r) => sum + (r.elevation_gain_meters ?? 0), 0)
      : 0
    const totalMovingSeconds = rides
      ? rides.reduce((sum, r) => sum + (r.moving_time_seconds ?? 0), 0)
      : 0
    const fastestRide = rides?.reduce<{ speed: number; name: string | null } | null>((best, r) => {
      if (r.average_speed_mps == null) return best
      if (!best || r.average_speed_mps > best.speed) return { speed: r.average_speed_mps, name: r.name }
      return best
    }, null)

    const lines = [
      `🚴 ${displayName}'s SF2G Stats`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🏁 ${totalRides} SF2G rides`,
      `📏 ${formatDistance(totalDistanceMeters, unit)} total distance`,
      `🏔️ ${formatElevation(totalElevation, unit)} total climbing`,
      `⏱️ ${formatMovingTime(totalMovingSeconds)} on the bike`,
    ]

    if (ytdRideCount > 0) {
      lines.push(`📅 ${ytdRideCount} rides in ${currentYear} (${formatDistance(ytdDistanceMeters, unit)})`)
    }

    if (fastestRide) {
      lines.push(`⚡ Top speed: ${formatSpeed(fastestRide.speed, unit)}`)
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━`)
    lines.push(`🔗 ${profileUrl}`)

    const statsText = lines.join('\n')

    if (navigator.share) {
      try {
        await navigator.share({
          text: statsText,
        })
      } catch {
        // User cancelled share — ignore
      }
    } else {
      await navigator.clipboard.writeText(statsText)
      toast.success('Stats copied to clipboard!')
    }
  }, [rides, displayName, totalRides, totalDistanceMeters, ytdRideCount, ytdDistanceMeters, currentYear, unit, profileUrl])

  // Early returns AFTER all hooks
  if (profileLoading) {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-6)' }}>
        <div className="loading-state">
          <div className="loading-state__spinner" />
          <p className="loading-state__text">Loading profile...</p>
        </div>
      </div>
    )
  }

  if (profileError || !profile) {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-6)' }}>
        <div className="error-state">
          <div className="error-state__icon">👤</div>
          <h2 className="error-state__title">Rider Not Found</h2>
          <p className="error-state__message">
            {profileError ?? 'This rider profile does not exist.'}
          </p>
          <Link
            to="/leaderboard"
            search={{ routes: [], search: '', ppr: false, other: false, company: undefined, user: undefined, view: 'riders' as const, chart: false, sort: 'sf2g_total', dir: 'desc' as const, rSort: 'ride_date', rDir: 'desc' as const, page: 1, dateFrom: undefined, dateTo: undefined, datePreset: undefined, density: 'expanded' as const }}
            className="btn btn--primary"
            style={{ marginTop: 'var(--space-4)' }}
          >
            Back to Leaderboard
          </Link>
        </div>
      </div>
    )
  }

  const memberSince = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="section">
      <div className="container">
        {/* Profile Header */}
        <div className="glass-card profile-header animate-fade-in">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.display_name ?? 'User'}
              className="profile-header__avatar"
            />
          ) : (
            <div
              className="profile-header__avatar"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--color-surface-hover)',
                fontSize: '32px',
              }}
            >
              👤
            </div>
          )}
          <div className="profile-header__info">
            <h1 className="profile-header__name">
              {profile.display_name ?? profile.username ?? 'Anonymous'}
            </h1>
            <div className="profile-header__stats">
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">{totalRides}</span>
                SF2G Rides
              </div>
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">
                  {formatDistance(totalDistanceMeters, unit)}
                </span>
                SF2G Distance
              </div>
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">{memberSince}</span>
                Member Since
              </div>
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">
                  {formatDistance(ytdDistanceMeters, unit)} / {ytdRideCount} rides
                </span>
                YTD
              </div>
            </div>
          </div>

          {/* Share buttons */}
          <div className="profile-header__share-buttons">
            <button
              className="btn btn--ghost btn--sm profile-header__share-btn"
              onClick={handleShareLink}
            >
              🔗 Share Profile
            </button>
            <button
              className="btn btn--ghost btn--sm profile-header__share-btn"
              onClick={handleShareStats}
            >
              📊 Share Stats
            </button>
          </div>

          {/* Disconnect Strava — only on own profile */}
          {isOwnProfile && (
            <div className="profile-header__disconnect">
              {!showDisconnectConfirm ? (
                <button
                  id="disconnect-strava-btn"
                  className="btn btn--danger btn--sm"
                  onClick={() => setShowDisconnectConfirm(true)}
                >
                  Disconnect Strava
                </button>
              ) : (
                <div className="profile-header__disconnect-confirm">
                  <p className="profile-header__disconnect-warning">
                    This will revoke SF2G's access to your Strava account. You can reconnect anytime by logging in again.
                  </p>
                  <div className="profile-header__disconnect-actions">
                    <button
                      id="disconnect-strava-confirm-btn"
                      className="btn btn--danger btn--sm"
                      onClick={handleDisconnectStrava}
                      disabled={disconnecting}
                    >
                      {disconnecting ? 'Disconnecting…' : 'Yes, Disconnect'}
                    </button>
                    <button
                      id="disconnect-strava-cancel-btn"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setShowDisconnectConfirm(false)}
                      disabled={disconnecting}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* SF2G Ride Stats + Pie Chart */}
        <div className="glass-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--font-bold)',
            marginBottom: 'var(--space-4)',
            color: 'var(--color-text)',
          }}>
            SF2G Stats
          </h2>
          {ridesLoading ? (
            <div className="loading-state">
              <div className="loading-state__spinner" />
            </div>
          ) : (
            <ProfileRideStats rides={rides ?? []} />
          )}
        </div>

        {/* Fun Stats & Insights */}
        <div className="glass-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--font-bold)',
            marginBottom: 'var(--space-4)',
            color: 'var(--color-text)',
          }}>
            Fun Stats & Insights
          </h2>
          {ridesLoading ? (
            <div className="loading-state">
              <div className="loading-state__spinner" />
            </div>
          ) : (
            <ProfileFunStats rides={rides ?? []} />
          )}
        </div>

        {/* Ride Frequency Chart */}
        <div className="glass-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--font-bold)',
            marginBottom: 'var(--space-4)',
            color: 'var(--color-text)',
          }}>
            Ride Frequency
          </h2>
          {ridesLoading ? (
            <div className="loading-state">
              <div className="loading-state__spinner" />
            </div>
          ) : (
            <RideFrequencyChart rides={rides ?? []} />
          )}
        </div>

        {/* All Rides Table */}
        <div style={{ marginTop: 'var(--space-5)' }}>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--font-bold)',
            marginBottom: 'var(--space-4)',
            color: 'var(--color-text)',
          }}>
            Ride History
          </h2>
          {ridesLoading ? (
            <div className="loading-state">
              <div className="loading-state__spinner" />
              <p className="loading-state__text">Loading rides...</p>
            </div>
          ) : !rides || rides.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">🚴</div>
              <h3 className="empty-state__title">No rides yet</h3>
              <p className="empty-state__description">
                This rider hasn't synced any rides yet.
              </p>
            </div>
          ) : (
            <ProfileRidesTable rides={rides} profileUserId={userId} />
          )}
        </div>
      </div>
    </div>
  )
}
