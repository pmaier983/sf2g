import { useMemo, useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import type { GrowthBucket } from "../server/leaderboard";
import type { Granularity } from "../lib/growth-granularity";

interface GrowthChartProps {
  /**
   * Ride counts per rider per bucket, already filtered exactly like the table
   * (fetchRiderGrowth). Bucket = day, Monday of the week, or 1st of the month.
   */
  buckets: GrowthBucket[];
  granularity: Granularity;
  visibleRiderIds: string[];
  riderColorMap: Map<string, string>;
  riderNameMap: Map<string, string>;
  onToggleRider?: (userId: string) => void;
}

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

/** Format a YYYY-MM string to a short label like "Jan 25". */
function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/** Format a YYYY-MM-DD string to a short daily label like "Jun 1". */
function formatDayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Format a week label using just the week start date, e.g. "Jun 2". */
function formatWeekLabel(_weekKey: string, weekStart: Date): string {
  return weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Format a zero-point label: the time bucket before the given first bucket.
 */
function formatZeroLabel(
  firstBucket: string,
  granularity: Granularity,
): string {
  if (granularity === "daily") {
    const [year, month, day] = firstBucket.split("-");
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    date.setDate(date.getDate() - 1);
    return formatDayLabel(date.toISOString().slice(0, 10));
  }
  if (granularity === "monthly") {
    const [year, month] = firstBucket.split("-");
    const date = new Date(Number(year), Number(month) - 2);
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
  }
  // weekly — handled separately via weekStartMap
  return "";
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
function GrowthTooltip({
  active,
  payload,
  label,
  riderNameMap,
}: TooltipProps<number, string> & { riderNameMap: Map<string, string> }) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: "var(--color-surface-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        fontSize: "var(--text-sm)",
        color: "var(--color-text)",
        padding: "8px 12px",
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: entry.color, margin: "2px 0" }}>
          {riderNameMap.get(String(entry.dataKey)) ?? entry.dataKey}:{" "}
          {entry.value} rides
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile detection hook
// ---------------------------------------------------------------------------
function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}

// ---------------------------------------------------------------------------
// GrowthChart component
// ---------------------------------------------------------------------------
export function GrowthChart({
  buckets,
  granularity,
  visibleRiderIds,
  riderColorMap,
  riderNameMap,
  onToggleRider,
}: GrowthChartProps) {
  const isMobile = useIsMobile();

  const chartData = useMemo(() => {
    const riderIds = visibleRiderIds;
    if (riderIds.length === 0) return [];
    const riderIdSet = new Set(riderIds);

    // Per-rider counts by bucket (YYYY-MM-DD bucket start from the server)
    const riderBuckets = new Map<string, Map<string, number>>();
    for (const b of buckets) {
      if (!riderIdSet.has(b.user_id)) continue;
      let m = riderBuckets.get(b.user_id);
      if (!m) {
        m = new Map<string, number>();
        riderBuckets.set(b.user_id, m);
      }
      m.set(b.bucket, (m.get(b.bucket) ?? 0) + b.count);
    }

    const sorted = Array.from(
      new Set(
        buckets.filter((b) => riderIdSet.has(b.user_id)).map((b) => b.bucket),
      ),
    ).sort();
    if (sorted.length === 0) return [];

    // Daily: fill missing days so the x-axis is continuous.
    let filled = sorted;
    if (granularity === "daily") {
      filled = [];
      const cursor = new Date(`${sorted[0]}T12:00:00Z`);
      const end = new Date(`${sorted[sorted.length - 1]}T12:00:00Z`);
      while (cursor <= end) {
        filled.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const cumulativeByRider = new Map<string, Map<string, number>>();
    for (const riderId of riderIds) {
      const m = riderBuckets.get(riderId);
      if (!m) continue;
      let total = 0;
      const c = new Map<string, number>();
      for (const bucket of filled) {
        total += m.get(bucket) ?? 0;
        c.set(bucket, total);
      }
      cumulativeByRider.set(riderId, c);
    }

    // Noon UTC keeps the calendar date stable in every time zone.
    const weekStart = (bucket: string) => new Date(`${bucket}T12:00:00Z`);
    const formatLabel = (bucket: string): string => {
      if (granularity === "daily") return formatDayLabel(bucket);
      if (granularity === "weekly")
        return formatWeekLabel(bucket, weekStart(bucket));
      return formatMonthLabel(bucket);
    };
    const zeroLabel = (() => {
      if (granularity === "weekly") {
        const prev = weekStart(filled[0]);
        prev.setUTCDate(prev.getUTCDate() - 1);
        return formatDayLabel(prev.toISOString().slice(0, 10));
      }
      return formatZeroLabel(filled[0], granularity);
    })();

    const zeroPoint: Record<string, string | number> = { month: zeroLabel };
    for (const riderId of riderIds) zeroPoint[riderId] = 0;

    const dataPoints = filled.map((bucket) => {
      const point: Record<string, string | number> = {
        month: formatLabel(bucket),
      };
      for (const riderId of riderIds) {
        point[riderId] = cumulativeByRider.get(riderId)?.get(bucket) ?? 0;
      }
      return point;
    });

    return [zeroPoint, ...dataPoints];
  }, [buckets, visibleRiderIds, granularity]);

  const riderIds = visibleRiderIds;

  // Let Recharts auto-skip overlapping labels via minTickGap
  const minTickGap =
    granularity === "daily"
      ? isMobile
        ? 30
        : 20
      : granularity === "weekly"
        ? isMobile
          ? 40
          : 25
        : isMobile
          ? 30
          : 20;

  if (chartData.length === 0) {
    return (
      <div className="leaderboard__growth-chart">
        <h2>Commute Growth</h2>
        <div className="empty-state" style={{ padding: "var(--space-6)" }}>
          <div className="empty-state__icon">📈</div>
          <h3 className="empty-state__title">No growth data</h3>
          <p className="empty-state__description">
            Ride data will appear here once riders have monthly stats.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="leaderboard__growth-chart">
      <div className="leaderboard__growth-header">
        <h2 className="leaderboard__growth-title">Commute Growth</h2>
      </div>
      <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{
              fontSize: isMobile ? 10 : 11,
              fill: "var(--color-text-muted)",
            }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={minTickGap}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--color-text-muted)" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <RechartsTooltip
            content={(props: TooltipProps<number, string>) => (
              <GrowthTooltip {...props} riderNameMap={riderNameMap} />
            )}
          />
          {riderIds.map((riderId) => (
            <Line
              key={riderId}
              type="monotone"
              dataKey={riderId}
              name={riderId}
              stroke={riderColorMap.get(riderId) ?? "var(--color-text-muted)"}
              strokeWidth={2}
              dot={granularity === "daily" ? false : { r: isMobile ? 1 : 2 }}
              activeDot={{ r: isMobile ? 3 : 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Custom clickable legend */}
      {riderIds.length > 0 && (
        <div className="growth-chart__legend">
          {riderIds.map((riderId) => {
            const color =
              riderColorMap.get(riderId) ?? "var(--color-text-muted)";
            const name = riderNameMap.get(riderId) ?? riderId;
            return (
              <button
                key={riderId}
                type="button"
                className="growth-chart__legend-item"
                onClick={() => onToggleRider?.(riderId)}
                title={`Remove ${name} from chart`}
              >
                <span
                  className="growth-chart__legend-dot"
                  style={{ background: color }}
                />
                <span className="growth-chart__legend-name">{name}</span>
                <span className="growth-chart__legend-remove">×</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
