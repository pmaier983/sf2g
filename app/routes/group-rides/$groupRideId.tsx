/**
 * Group Ride detail page — /group-rides/:groupRideId
 *
 * Shows an animated map replay, offset chart, and comparison table
 * for a group ride. Streams are lazily fetched from Strava on first view.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { groupRideDetailQueryOptions } from "../../queries/group-rides";
import { GroupRideMap } from "../../components/GroupRideMap";
import { GroupRideOffsetChart } from "../../components/GroupRideOffsetChart";
import { GroupRideComparisonTable } from "../../components/GroupRideComparisonTable";
import { toast } from "../../components/Toast";
import { RIDER_COLORS } from "../../lib/constants";
import type { RouteCategory } from "../../lib/database.types";
import type {
  GroupRideDetailRider,
  StreamFetchError,
} from "../../server/group-rides";

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

interface GroupRideSearch {
  date: string;
  route: RouteCategory;
  riders: string; // comma-separated rider IDs
}

export const Route = createFileRoute("/group-rides/$groupRideId")({
  validateSearch: (raw: Record<string, unknown>): GroupRideSearch => ({
    date: (raw.date as string) || "",
    route: (raw.route as RouteCategory) || "bayway",
    riders: (raw.riders as string) || "",
  }),
  component: GroupRideDetailPage,
  head: () => ({
    meta: [
      { title: "Group Ride — SF2G" },
      {
        name: "description",
        content: "Group ride details and replay",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Speed options for playback
// ---------------------------------------------------------------------------

const SPEED_OPTIONS = [10, 100, 500] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GroupRideDetailPage() {
  const { groupRideId } = Route.useParams();
  const { date, route, riders: ridersParam } = Route.useSearch();
  const riderIds = ridersParam ? ridersParam.split(",").filter(Boolean) : [];

  // Query for group ride detail (lazy-fetches streams)
  const { data, isLoading, error } = useQuery(
    groupRideDetailQueryOptions({
      id: groupRideId,
      date,
      route,
      riderIds,
    }),
  );

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState<number>(100);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  // Trim state (in minutes for UI, converted to seconds for logic)
  const [trimStartMin, setTrimStartMin] = useState(0);
  const [trimEndMin, setTrimEndMin] = useState(0);
  const trimStartSec = trimStartMin * 60;
  const trimEndSec = trimEndMin * 60;

  // Compute raw total duration from rider streams (before trim)
  const rawDuration = useMemo(() => {
    if (!data?.riders.length) return 0;

    // Compute earliest start date once (not per-rider)
    const earliestStart = data.riders.reduce((earliest: number, r) => {
      const t = new Date(r.ride.start_date).getTime();
      return t < earliest ? t : earliest;
    }, Infinity);

    if (!isFinite(earliestStart)) return 0;

    const duration = data.riders.reduce((max: number, rider) => {
      if (!rider.streams || rider.streams.time.length === 0) return max;
      const riderStart = new Date(rider.ride.start_date).getTime();
      const offset = (riderStart - earliestStart) / 1000;
      const lastTime = rider.streams.time[rider.streams.time.length - 1] ?? 0;
      const riderEnd = offset + lastTime;
      return Math.max(max, riderEnd);
    }, 0);

    if (duration === 0 && data.riders.some((r) => r.streams)) {
      console.warn(
        "[GroupRide] totalDuration is 0 despite having streams. Rider data:",
        data.riders.map((r) => ({
          name: r.displayName,
          hasStreams: !!r.streams,
          timeLength: r.streams?.time.length,
          lastTime: r.streams?.time[r.streams.time.length - 1],
          startDate: r.ride.start_date,
        })),
      );
    }

    return duration;
  }, [data?.riders]);

  // Effective duration after trimming
  const totalDuration = Math.max(0, rawDuration - trimStartSec - trimEndSec);

  // Max trim values (in minutes) — prevent trimming more than the ride
  const maxTrimStartMin = Math.max(
    0,
    Math.floor((rawDuration - trimEndSec) / 60),
  );
  const maxTrimEndMin = Math.max(
    0,
    Math.floor((rawDuration - trimStartSec) / 60),
  );

  // The absolute time to pass to child components (offset by trimStart)
  const adjustedCurrentTime = currentTime + trimStartSec;

  // Reset currentTime when trim changes push it out of range
  useEffect(() => {
    if (currentTime > totalDuration) {
      setCurrentTime(Math.max(0, totalDuration));
    }
  }, [totalDuration, currentTime]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || totalDuration === 0) return;

    const animate = (timestamp: number) => {
      if (lastFrameRef.current === 0) lastFrameRef.current = timestamp;

      const delta = (timestamp - lastFrameRef.current) / 1000; // seconds
      lastFrameRef.current = timestamp;

      setCurrentTime((prev) => {
        const next = prev + delta * speed;
        if (next >= totalDuration) {
          setIsPlaying(false);
          return totalDuration;
        }
        return next;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    lastFrameRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, speed, totalDuration]);

  // Show toasts for stream errors
  useEffect(() => {
    if (!data?.streamErrors.length) return;

    for (const err of data.streamErrors) {
      switch (err.type) {
        case "RATE_LIMITED_DAILY":
          toast.error("Daily Strava limit reached", {
            description:
              "The daily API limit (1,000 requests) has been hit. Cached streams are still available. Try again tomorrow.",
          });
          return; // Show only the most severe toast
        case "RATE_LIMITED_15MIN":
          toast.warning("Strava rate limit reached", {
            description:
              "Too many requests in the last 15 minutes. Try again in ~15 min. Streams already fetched are cached.",
          });
          return;
        case "REAUTH_REQUIRED":
          toast.info("Stream unavailable", {
            description: `${err.displayName} needs to re-login to Strava to share ride data.`,
          });
          break;
        case "PRIVATE_ACTIVITY":
        case "FETCH_ERROR":
          // Less critical — don't toast for each one
          break;
      }
    }

    // Summary toast for partial data
    const ridersWithStreams = data.riders.filter(
      (r: GroupRideDetailRider) => r.streams,
    ).length;
    const totalRiders = data.riders.length;
    if (ridersWithStreams > 0 && ridersWithStreams < totalRiders) {
      toast.warning("Partial data loaded", {
        description: `${ridersWithStreams} of ${totalRiders} rider streams loaded. Showing available data — try again later for the rest.`,
      });
    }
  }, [data?.streamErrors, data?.riders]);

  const handlePlayPause = useCallback(() => {
    if (currentTime >= totalDuration) {
      setCurrentTime(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((prev) => !prev);
    }
  }, [currentTime, totalDuration]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setCurrentTime(value);
    setIsPlaying(false);
  }, []);

  const formatPlaybackTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // Rider colors
  const riderColors =
    data?.riders.map(
      (_: GroupRideDetailRider, i: number) =>
        RIDER_COLORS[i % RIDER_COLORS.length],
    ) ?? [];

  // Loading state
  if (isLoading) {
    return (
      <div className="group-ride-detail">
        <div className="group-ride-detail__loading">
          <div className="group-ride-detail__loading-spinner" />
          <p>Loading group ride data...</p>
          <p style={{ fontSize: "var(--text-xs)" }}>
            Fetching ride streams from Strava (this may take a moment for first
            views)
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="group-ride-detail">
        <Link
          to="/leaderboard"
          search={{
            routes: [],
            search: "",
            ppr: false,
            other: false,
            weekends: true,
            company: undefined,
            user: undefined,
            view: "groups" as const,
            duration: "1y",
            chart: false,
            sort: "sf2g_total",
            dir: "desc" as const,
            rSort: "ride_date",
            rDir: "desc" as const,
            page: 1,
            dateFrom: undefined,
            dateTo: undefined,
            datePreset: undefined,
            density: "condensed" as const,
            reverse: false,
            gSort: "date",
            gDir: "desc" as const,
            gPage: 1,
          }}
          className="group-ride-detail__back"
        >
          ← Back to Group Rides
        </Link>
        <div className="group-ride-detail__loading">
          <p>Failed to load group ride data.</p>
          <p
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-error, #ef4444)",
            }}
          >
            {error?.message ?? "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  const formattedDate = new Date(data.date + "T12:00:00").toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    },
  );

  const routeLabel =
    data.routeCategory.charAt(0).toUpperCase() + data.routeCategory.slice(1);
  const hasStreams = data.riders.some((r) => r.streams);

  return (
    <div className="group-ride-detail">
      {/* Header */}
      <div className="group-ride-detail__header">
        <Link
          to="/leaderboard"
          search={{
            routes: [],
            search: "",
            ppr: false,
            other: false,
            weekends: true,
            company: undefined,
            user: undefined,
            view: "groups" as const,
            duration: "1y",
            chart: false,
            sort: "sf2g_total",
            dir: "desc" as const,
            rSort: "ride_date",
            rDir: "desc" as const,
            page: 1,
            dateFrom: undefined,
            dateTo: undefined,
            datePreset: undefined,
            density: "condensed" as const,
            reverse: false,
            gSort: "date",
            gDir: "desc" as const,
            gPage: 1,
          }}
          className="group-ride-detail__back"
        >
          ← Back to Group Rides
        </Link>
        <h1 className="group-ride-detail__title">Group Ride — {routeLabel}</h1>
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
              {!rider.streams && (
                <span style={{ opacity: 0.5 }}> (no stream)</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stream error banners */}
      {data.streamErrors.length > 0 &&
        data.streamErrors.some(
          (e: StreamFetchError) => e.type === "RATE_LIMITED_DAILY",
        ) && (
          <div className="group-ride-detail__stream-banner group-ride-detail__stream-banner--error">
            ⚠️ Daily Strava API limit reached. Some ride streams could not be
            loaded. Try again tomorrow.
          </div>
        )}

      {/* Map + Chart */}
      {hasStreams && (
        <div className="group-ride-detail__content">
          <div className="group-ride-detail__map-column">
            <GroupRideMap
              riders={data.riders}
              currentTime={adjustedCurrentTime}
              isPlaying={isPlaying}
              trimStartSec={trimStartSec}
              trimEndSec={trimEndSec}
              rawDuration={rawDuration}
            />

            {/* Playback Controls */}
            <div className="group-ride-playback">
              <button
                type="button"
                className="group-ride-playback__play-btn"
                onClick={handlePlayPause}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>

              <div className="group-ride-playback__speed-btns">
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`group-ride-playback__speed-btn${speed === s ? " group-ride-playback__speed-btn--active" : ""}`}
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
                {formatPlaybackTime(currentTime)} /{" "}
                {formatPlaybackTime(totalDuration)}
              </span>
            </div>

            {/* Trim Controls */}
            <div className="group-ride-trim">
              <div className="group-ride-trim__control">
                <label className="group-ride-trim__label" htmlFor="trim-start">
                  Trim start
                </label>
                <div className="group-ride-trim__input-wrapper">
                  <input
                    id="trim-start"
                    type="number"
                    className="group-ride-trim__input"
                    min={0}
                    max={maxTrimStartMin}
                    step={1}
                    value={trimStartMin}
                    onChange={(e) => {
                      const v = Math.max(
                        0,
                        Math.min(maxTrimStartMin, Number(e.target.value) || 0),
                      );
                      setTrimStartMin(v);
                    }}
                  />
                  <span className="group-ride-trim__unit">min</span>
                </div>
              </div>
              <div className="group-ride-trim__control">
                <label className="group-ride-trim__label" htmlFor="trim-end">
                  Trim end
                </label>
                <div className="group-ride-trim__input-wrapper">
                  <input
                    id="trim-end"
                    type="number"
                    className="group-ride-trim__input"
                    min={0}
                    max={maxTrimEndMin}
                    step={1}
                    value={trimEndMin}
                    onChange={(e) => {
                      const v = Math.max(
                        0,
                        Math.min(maxTrimEndMin, Number(e.target.value) || 0),
                      );
                      setTrimEndMin(v);
                    }}
                  />
                  <span className="group-ride-trim__unit">min</span>
                </div>
              </div>
              {(trimStartMin > 0 || trimEndMin > 0) && (
                <button
                  type="button"
                  className="group-ride-trim__reset"
                  onClick={() => {
                    setTrimStartMin(0);
                    setTrimEndMin(0);
                    setCurrentTime(0);
                  }}
                >
                  Reset trim
                </button>
              )}
            </div>
          </div>

          <GroupRideOffsetChart
            riders={data.riders}
            currentTime={adjustedCurrentTime}
            trimStartSec={trimStartSec}
            trimEndSec={trimEndSec}
          />
        </div>
      )}

      {/* No streams fallback */}
      {!hasStreams && (
        <div className="group-ride-detail__stream-banner">
          No stream data available for this group ride. Streams are fetched from
          Strava on first view.
        </div>
      )}

      {/* Comparison Table */}
      <GroupRideComparisonTable
        riders={data.riders}
        riderColors={riderColors}
      />
    </div>
  );
}
