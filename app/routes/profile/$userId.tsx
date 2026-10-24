import { createFileRoute, Link } from "@tanstack/react-router";
import { leaderboardSearch } from "../../lib/table-query";
import { SF2G_TIME_ZONE, yearInLA } from "../../lib/dates";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback, lazy, Suspense } from "react";
import { userRidesQueryOptions } from "../../queries/rides";
import { fetchUserProfile } from "../../server/users";
import { disconnectStrava } from "../../server/auth";
import { currentUserQueryOptions } from "../../queries/user";
import { ProfileRidesTable } from "../../components/ProfileRidesTable";
const RideFrequencyChart = lazy(() =>
  import("../../components/RideFrequencyChart").then((m) => ({
    default: m.RideFrequencyChart,
  })),
);
const ProfileRideStats = lazy(() =>
  import("../../components/ProfileRideStats").then((m) => ({
    default: m.ProfileRideStats,
  })),
);
const ProfileFunStats = lazy(() =>
  import("../../components/ProfileFunStats").then((m) => ({
    default: m.ProfileFunStats,
  })),
);
import { useUnit } from "../../lib/useUnit";
import {
  formatDistance,
  formatElevation,
  formatSpeed,
  formatMovingTime,
} from "../../lib/leaderboard-utils";
import { toast } from "../../components/Toast";

export const Route = createFileRoute("/profile/$userId")({
  // Loaded on the server so the page (and its <title>) render with the name.
  loader: async ({ params }) => {
    try {
      return {
        profile: await fetchUserProfile({ data: { userId: params.userId } }),
        error: null,
      };
    } catch (err) {
      return {
        profile: null,
        error: err instanceof Error ? err.message : "Failed to load profile",
      };
    }
  },
  head: ({ loaderData }) => {
    const p = loaderData?.profile;
    const name = p?.display_name ?? p?.username;
    return {
      meta: [
        { title: name ? `${name} — SF2G` : "Rider not found — SF2G" },
        {
          name: "description",
          content: name
            ? `${name}'s SF2G bike commutes: rides, routes, speed and streaks.`
            : "SF2G rider profile.",
        },
      ],
    };
  },
  component: ProfilePage,
});

function ProfilePage() {
  const { userId } = Route.useParams();
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const { profile, error: profileError } = Route.useLoaderData();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const unit = useUnit();
  const isOwnProfile = currentUser?.id === userId;

  const { data: rides, isLoading: ridesLoading } = useQuery(
    userRidesQueryOptions(userId),
  );

  const handleDisconnectStrava = async () => {
    setDisconnecting(true);
    try {
      const result = await disconnectStrava();
      if (result.redirectTo) {
        window.location.href = result.redirectTo;
      }
    } catch {
      setDisconnecting(false);
      setShowDisconnectConfirm(false);
    }
  };

  // Rides are server-side filtered (is_hidden=false), so all stats exclude hidden rides
  // SF2G rides exclude 'other' category to match leaderboard's sf2g_total definition
  const sf2gRides = rides
    ? rides.filter((r) => r.route_category !== "other")
    : [];
  const sf2gRideCount = sf2gRides.length;
  const sf2gDistanceMeters = sf2gRides.reduce(
    (sum, r) => sum + (r.distance_meters ?? 0),
    0,
  );

  const currentYear = String(yearInLA());
  const ytdRides = sf2gRides.filter((r) => r.ride_date.startsWith(currentYear));
  const ytdRideCount = ytdRides.length;
  const ytdDistanceMeters = ytdRides.reduce(
    (sum, r) => sum + (r.distance_meters ?? 0),
    0,
  );

  const displayName = profile?.display_name ?? profile?.username ?? "Anonymous";
  const profileUrl = `https://sf2ging.com/profile/${userId}`;

  // All hooks must be called before any early returns
  const handleShareLink = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${displayName} on SF2G`,
          url: profileUrl,
        });
      } catch {
        // User cancelled share — ignore
      }
    } else {
      await navigator.clipboard.writeText(profileUrl);
      toast.success("Profile link copied!");
    }
  }, [displayName, profileUrl]);

  const handleShareStats = useCallback(async () => {
    // Compute some fun stats for the text
    const totalElevation = rides
      ? rides.reduce((sum, r) => sum + (r.elevation_gain_meters ?? 0), 0)
      : 0;
    const totalMovingSeconds = rides
      ? rides.reduce((sum, r) => sum + (r.moving_time_seconds ?? 0), 0)
      : 0;
    const fastestRide = rides?.reduce<{
      speed: number;
      name: string | null;
    } | null>((best, r) => {
      if (r.average_speed_mps == null) return best;
      if (!best || r.average_speed_mps > best.speed)
        return { speed: r.average_speed_mps, name: r.name };
      return best;
    }, null);

    const lines = [
      `🚴 ${displayName}'s SF2G Stats`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🏁 ${sf2gRideCount} SF2G rides`,
      `📏 ${formatDistance(sf2gDistanceMeters, unit)} total distance`,
      `🏔️ ${formatElevation(totalElevation, unit)} total climbing`,
      `⏱️ ${formatMovingTime(totalMovingSeconds)} on the bike`,
    ];

    if (ytdRideCount > 0) {
      lines.push(
        `📅 ${ytdRideCount} rides in ${currentYear} (${formatDistance(ytdDistanceMeters, unit)})`,
      );
    }

    if (fastestRide) {
      lines.push(`⚡ Top speed: ${formatSpeed(fastestRide.speed, unit)}`);
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`🔗 ${profileUrl}`);

    const statsText = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({
          text: statsText,
        });
      } catch {
        // User cancelled share — ignore
      }
    } else {
      await navigator.clipboard.writeText(statsText);
      toast.success("Stats copied to clipboard!");
    }
  }, [
    rides,
    displayName,
    sf2gRideCount,
    sf2gDistanceMeters,
    ytdRideCount,
    ytdDistanceMeters,
    currentYear,
    unit,
    profileUrl,
  ]);

  // Early returns AFTER all hooks
  if (profileError || !profile) {
    return (
      <div className="container" style={{ paddingTop: "var(--space-6)" }}>
        <div className="error-state">
          <div className="error-state__icon">👤</div>
          <h2 className="error-state__title">Rider Not Found</h2>
          <p className="error-state__message">
            {profileError ?? "This rider profile does not exist."}
          </p>
          <Link
            to="/leaderboard"
            search={leaderboardSearch()}
            className="btn btn--primary"
            style={{ marginTop: "var(--space-4)" }}
          >
            Back to Leaderboard
          </Link>
        </div>
      </div>
    );
  }

  // Explicit zone: the server render (UTC) and the browser must agree.
  const memberSince = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: SF2G_TIME_ZONE,
  });

  return (
    <div className="section">
      <div className="container">
        {/* Profile Header */}
        <div className="glass-card profile-header animate-fade-in">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.display_name ?? "User"}
              className="profile-header__avatar"
            />
          ) : (
            <div
              className="profile-header__avatar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--color-surface-hover)",
                fontSize: "32px",
              }}
            >
              👤
            </div>
          )}
          <div className="profile-header__info">
            <h1 className="profile-header__name">
              {profile.display_name ?? profile.username ?? "Anonymous"}
            </h1>
            <div className="profile-header__stats">
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">
                  {sf2gRideCount}
                </span>
                SF2G Rides
              </div>
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">
                  {formatDistance(sf2gDistanceMeters, unit)}
                </span>
                SF2G Distance
              </div>
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">
                  {memberSince}
                </span>
                Member Since
              </div>
              <div className="profile-header__stat">
                <span className="profile-header__stat-value">
                  {formatDistance(ytdDistanceMeters, unit)} / {ytdRideCount}{" "}
                  rides
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
                  <div className="profile-header__disconnect-warning">
                    <p
                      style={{
                        fontWeight: "var(--font-semibold)",
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      Are you sure? This action will:
                    </p>
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: "0 0 var(--space-3) 0",
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--space-1)",
                      }}
                    >
                      <li>🔑 Revoke SF2G's access to your Strava account</li>
                      <li>
                        🗑️ Permanently delete all your ride data (
                        {rides?.length ?? 0} rides) from SF2G
                      </li>
                      <li>📊 Remove your leaderboard rankings and stats</li>
                      <li>🏆 Remove your profile from the community network</li>
                    </ul>
                    <p
                      style={{
                        color: "var(--color-text-muted)",
                        fontSize: "var(--text-sm)",
                      }}
                    >
                      You can reconnect anytime by logging in again — your rides
                      will be re-synced from Strava.
                    </p>
                  </div>
                  <div className="profile-header__disconnect-actions">
                    <button
                      id="disconnect-strava-confirm-btn"
                      className="btn btn--danger btn--sm"
                      onClick={handleDisconnectStrava}
                      disabled={disconnecting}
                    >
                      {disconnecting ? "Disconnecting…" : "Yes, Disconnect"}
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
        <div
          className="glass-card"
          style={{ padding: "var(--space-5)", marginTop: "var(--space-5)" }}
        >
          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: "var(--font-bold)",
              marginBottom: "var(--space-4)",
              color: "var(--color-text)",
            }}
          >
            SF2G Stats
          </h2>
          {ridesLoading ? (
            <div className="loading-state">
              <div className="loading-state__spinner" />
            </div>
          ) : (
            <Suspense fallback={<div className="chart-skeleton" />}>
              <ProfileRideStats rides={rides ?? []} />
            </Suspense>
          )}
        </div>

        {/* Fun Stats & Insights */}
        <div
          className="glass-card"
          style={{ padding: "var(--space-5)", marginTop: "var(--space-5)" }}
        >
          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: "var(--font-bold)",
              marginBottom: "var(--space-4)",
              color: "var(--color-text)",
            }}
          >
            Fun Stats & Insights
          </h2>
          {ridesLoading ? (
            <div className="loading-state">
              <div className="loading-state__spinner" />
            </div>
          ) : (
            <Suspense fallback={<div className="chart-skeleton" />}>
              <ProfileFunStats rides={rides ?? []} />
            </Suspense>
          )}
        </div>

        {/* Ride Frequency Chart */}
        <div
          className="glass-card"
          style={{ padding: "var(--space-5)", marginTop: "var(--space-5)" }}
        >
          <h2
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: "var(--font-bold)",
              marginBottom: "var(--space-4)",
              color: "var(--color-text)",
            }}
          >
            Ride Frequency
          </h2>
          {ridesLoading ? (
            <div className="loading-state">
              <div className="loading-state__spinner" />
            </div>
          ) : (
            <Suspense fallback={<div className="chart-skeleton" />}>
              <RideFrequencyChart rides={rides ?? []} />
            </Suspense>
          )}
        </div>

        {/* All Rides Table — only visible on own profile */}
        {isOwnProfile && (
          <div style={{ marginTop: "var(--space-5)" }}>
            <h2
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: "var(--font-bold)",
                marginBottom: "var(--space-4)",
                color: "var(--color-text)",
              }}
            >
              Ride History
            </h2>
            <ProfileRidesTable profileUserId={userId} />
          </div>
        )}
      </div>
    </div>
  );
}
