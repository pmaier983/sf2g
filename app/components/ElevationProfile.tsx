/**
 * Elevation profile of a corridor route with its segments packed into lanes
 * underneath, like the Strava activity page (phase 07c).
 *
 * Hand-written SVG so the lanes share the profile's x-scale to the pixel.
 * Bars are HTML buttons (focusable; Enter selects). One info line above the
 * chart reads out the hovered point, the hovered segment, or the selected one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CorridorProfile } from "../lib/corridor-profile";
import { pointAtDistance } from "../lib/corridor-profile";
import type { PlacedBar } from "../lib/segment-lanes";
import { laneCount } from "../lib/segment-lanes";
import { METERS_PER_MILE, METERS_TO_FEET } from "../lib/constants";
import {
  formatSegmentDistance,
  formatSegmentTime,
} from "../lib/segment-format";
import type { SegmentBoardRow } from "../server/segments";
import type { UnitSystem } from "./UnitToggle";

export interface ElevationProfileProps {
  profile: CorridorProfile;
  bars: PlacedBar[];
  /** Board rows by id, for labels and terrain. */
  segments: ReadonlyMap<number, SegmentBoardRow>;
  unit: UnitSystem;
  hoveredId: number | null;
  selectedId: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
  /** Metres along the route under the pointer (moves the map marker). */
  onHoverDistance?: (m: number | null) => void;
  /** Width before the first measurement (SSR, tests). */
  initialWidth?: number;
}

const MARGIN = { left: 56, right: 12, top: 8, bottom: 22 };
const PLOT_HEIGHT = 160;

/** A "nice" tick step (1, 2, 2.5 or 5 × 10^n) giving about `count` ticks. */
function niceStep(range: number, count: number): number {
  const raw = range / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ElevationProfile({
  profile,
  bars,
  segments,
  unit,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  onHoverDistance,
  initialWidth = 800,
}: ElevationProfileProps) {
  const [containerRef, width] = useWidth(initialWidth);
  const [hoverM, setHoverM] = useState<number | null>(null);

  const total = profile.distance[profile.points - 1];
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const x = (m: number) => MARGIN.left + (m / total) * plotW;

  // Y axis in display units (ft or m), domain padded to whole steps.
  const toUnit = unit === "km" ? 1 : METERS_TO_FEET;
  const altUnit = unit === "km" ? "m" : "ft";
  const yAxis = useMemo(() => {
    const lo = Math.min(...profile.altitude) * toUnit;
    const hi = Math.max(...profile.altitude) * toUnit;
    const step = niceStep(Math.max(hi - lo, 1), 4);
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
    return { min, max, ticks };
  }, [profile, toUnit]);
  const y = (meters: number) =>
    MARGIN.top +
    PLOT_HEIGHT -
    ((meters * toUnit - yAxis.min) / (yAxis.max - yAxis.min)) * PLOT_HEIGHT;

  // X ticks every 5 mi / 5 km.
  const distUnitM = unit === "km" ? 1000 : METERS_PER_MILE;
  const distLabel = unit === "km" ? "km" : "mi";
  const xTicks: number[] = [];
  for (let d = 0; d <= total; d += 5 * distUnitM) xTicks.push(d);

  const { line, area } = useMemo(() => {
    const pts = profile.distance.map(
      (d, i) => `${x(d).toFixed(1)},${y(profile.altitude[i]).toFixed(1)}`,
    );
    const base = (MARGIN.top + PLOT_HEIGHT).toFixed(1);
    return {
      line: `M${pts.join("L")}`,
      area: `M${x(0).toFixed(1)},${base}L${pts.join("L")}L${x(total).toFixed(1)},${base}Z`,
    };
    // x and y are derived from width/profile/yAxis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, width, yAxis, total]);

  const lanes = laneCount(bars);
  const svgHeight = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom;

  const setPointer = (m: number | null) => {
    setHoverM(m);
    onHoverDistance?.(m);
  };
  const onPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / Math.max(rect.width, 1);
    setPointer(Math.max(0, Math.min(1, frac)) * total);
  };

  // Info line: hovered point > hovered segment > selected segment.
  const focusId = hoveredId ?? selectedId;
  const focus = focusId != null ? segments.get(focusId) : undefined;
  let info: string;
  if (hoverM !== null) {
    const alt = pointAtDistance(profile, hoverM).altitude * toUnit;
    info = `${(hoverM / distUnitM).toFixed(1)} ${distLabel} · ${Math.round(alt).toLocaleString("en-US")} ${altUnit}`;
  } else if (focus) {
    const leader = focus.riders[0];
    info = [
      focus.name,
      `${formatSegmentDistance(focus.distance_meters, unit)} · ${focus.average_grade.toFixed(1)}%`,
      focus.kom_seconds ? `KOM ${formatSegmentTime(focus.kom_seconds)}` : null,
      leader
        ? `${leader.display_name} ${formatSegmentTime(leader.best_seconds)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    info = `${(total / distUnitM).toFixed(1)} ${distLabel} · ${bars.length} segments — hover or tap a bar`;
  }

  return (
    <div className="elevation" ref={containerRef}>
      <p className="elevation__info" aria-live="polite">
        {info}
      </p>
      <svg
        className="elevation__chart"
        width={width}
        height={svgHeight}
        role="img"
        aria-label={`Elevation profile, ${(total / distUnitM).toFixed(1)} ${distLabel}`}
      >
        {yAxis.ticks.map((v) => {
          const ty = y(v / toUnit);
          return (
            <g key={v}>
              <line
                className="elevation__grid"
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={ty}
                y2={ty}
              />
              <text
                className="elevation__tick"
                x={MARGIN.left - 6}
                y={ty}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {v.toLocaleString("en-US")} {altUnit}
              </text>
            </g>
          );
        })}
        <path className="elevation__area" d={area} />
        <path className="elevation__line" d={line} />
        {xTicks.map((d) => (
          <text
            key={d}
            className="elevation__tick"
            x={x(d)}
            y={MARGIN.top + PLOT_HEIGHT + 15}
            textAnchor={d === 0 ? "start" : "middle"}
          >
            {d === 0 ? `0 ${distLabel}` : (d / distUnitM).toFixed(0)}
          </text>
        ))}
        {hoverM !== null && (
          <g className="elevation__crosshair">
            <line
              x1={x(hoverM)}
              x2={x(hoverM)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_HEIGHT}
            />
            <circle
              cx={x(hoverM)}
              cy={y(pointAtDistance(profile, hoverM).altitude)}
              r={4}
            />
          </g>
        )}
        <rect
          className="elevation__hit"
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotW}
          height={PLOT_HEIGHT}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setPointer(null)}
        />
      </svg>

      <div className="elevation__lanes-row">
        <span
          className="elevation__lanes-label"
          style={{ width: MARGIN.left - 8 }}
        >
          Segments
        </span>
        <div
          className="elevation__lanes"
          style={
            {
              "--lanes": lanes,
              marginLeft: 8,
              width: plotW,
            } as React.CSSProperties
          }
          role="group"
          aria-label="Segments along the route"
        >
          {bars.map((b) => {
            const seg = segments.get(b.id);
            if (!seg) return null;
            const left = x(b.startM) - MARGIN.left;
            const w = Math.max(3, x(b.endM) - x(b.startM));
            const state =
              b.id === selectedId
                ? " elevation__bar--selected"
                : b.id === hoveredId
                  ? " elevation__bar--hovered"
                  : "";
            return (
              <button
                key={b.id}
                type="button"
                className={`elevation__bar elevation__bar--${seg.terrain}${state}`}
                style={
                  {
                    left,
                    width: w,
                    "--lane": b.lane,
                  } as React.CSSProperties
                }
                aria-label={`${seg.name}, ${formatSegmentDistance(seg.distance_meters, unit)}, ${seg.average_grade.toFixed(1)}%`}
                aria-pressed={b.id === selectedId}
                data-segment-id={b.id}
                onMouseEnter={() => onHover(b.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(b.id)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(b.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
