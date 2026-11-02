/**
 * Route tabs for /segments: one per corridor in SEGMENT_CORRIDORS, plus the
 * routes planned next, shown disabled. (default — Phillip may hide them)
 */
import {
  ROUTE_COLORS,
  SEGMENT_CORRIDORS,
  type SegmentCorridor,
} from "../lib/constants";
import type { RouteCategory } from "../lib/database.types";

/** Corridors without a reference line yet. */
const COMING_SOON: { key: RouteCategory; label: string }[] = [
  { key: "bayway", label: "Bayway" },
  { key: "hmbw", label: "HMBW" },
];

export interface CorridorTabsProps {
  corridor: SegmentCorridor;
  onChange: (corridor: SegmentCorridor) => void;
}

export function CorridorTabs({ corridor, onChange }: CorridorTabsProps) {
  const live = Object.entries(SEGMENT_CORRIDORS) as [
    SegmentCorridor,
    { label: string },
  ][];
  return (
    <div className="corridor-tabs" role="tablist" aria-label="Route">
      {live.map(([key, { label }]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={key === corridor}
          className={`corridor-tabs__tab${key === corridor ? " corridor-tabs__tab--active" : ""}`}
          style={{ "--tab-color": ROUTE_COLORS[key] } as React.CSSProperties}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
      {COMING_SOON.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={false}
          aria-disabled="true"
          disabled
          className="corridor-tabs__tab corridor-tabs__tab--soon"
          title={`${label} segments are coming`}
        >
          {label}
          <span className="corridor-tabs__soon">soon</span>
        </button>
      ))}
    </div>
  );
}
