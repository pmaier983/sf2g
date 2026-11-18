/**
 * Which segments count (phase 09d): presets, a length range, direction and
 * year, and a summary of the selection. Every value lives in the URL
 * (CumulativeQuery). Manual on/off per segment happens on the route view's
 * lanes and in the Segments view.
 */
import { useEffect, useState } from "react";
import type { CumulativeQuery } from "../lib/segment-query";
import { formatSegmentDistance } from "../lib/segment-format";
import { useUnit } from "../lib/useUnit";
import { CopyLinkButton } from "./CopyLinkButton";

const SETS: { value: CumulativeQuery["set"]; label: string; title: string }[] =
  [
    {
      value: "core",
      label: "Core",
      title: "The longest chain of popular segments that do not overlap",
    },
    { value: "climbs", label: "Climbs", title: "Every climb, no overlaps" },
    { value: "flats", label: "Flats", title: "Every flat, no overlaps" },
    {
      value: "custom",
      label: "Custom",
      title: "Your own pick: tap segments on the profile",
    },
  ];

export interface SegmentPickerProps {
  query: CumulativeQuery;
  onChange: (patch: Partial<CumulativeQuery>) => void;
  years: number[];
  /** Shortest and longest selectable segment, in km. */
  lengthBounds: [number, number];
  selected: { count: number; distanceM: number; climbM: number };
  overlapM: number;
  onRemoveOverlaps: () => void;
}

function Chips<V extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: V; label: string; title?: string }[];
  value: V;
  onSelect: (v: V) => void;
}) {
  return (
    <div className="filter-section">
      <span className="filter-section__label">{label}</span>
      <div className="filter-chips__group" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.title}
              className={`filter-chip filter-chip--company${on ? " filter-chip--selected" : ""}`}
              onClick={() => onSelect(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Two native range inputs over one track; values in km, 0.1 steps. */
export function LengthRange({
  bounds,
  min,
  max,
  onChange,
}: {
  bounds: [number, number];
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [lo, hi] = [
    Math.floor(bounds[0] * 10) / 10,
    Math.ceil(bounds[1] * 10) / 10,
  ];
  const [draft, setDraft] = useState<[number, number]>([min ?? lo, max ?? hi]);
  useEffect(() => setDraft([min ?? lo, max ?? hi]), [min, max, lo, hi]);
  // Debounce into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      const nextMin = draft[0] <= lo ? null : draft[0];
      const nextMax = draft[1] >= hi ? null : draft[1];
      if (nextMin !== min || nextMax !== max) onChange(nextMin, nextMax);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const span = Math.max(hi - lo, 0.1);
  const pct = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="filter-section length-range">
      <span className="filter-section__label" id="length-range-label">
        Length {draft[0].toFixed(1)}–{draft[1].toFixed(1)} km
      </span>
      <div
        className="length-range__track"
        style={
          {
            "--from": `${pct(draft[0])}%`,
            "--to": `${pct(draft[1])}%`,
          } as React.CSSProperties
        }
      >
        <input
          type="range"
          min={lo}
          max={hi}
          step={0.1}
          value={draft[0]}
          aria-label="Shortest segment (km)"
          onChange={(e) =>
            setDraft([Math.min(Number(e.target.value), draft[1]), draft[1]])
          }
        />
        <input
          type="range"
          min={lo}
          max={hi}
          step={0.1}
          value={draft[1]}
          aria-label="Longest segment (km)"
          onChange={(e) =>
            setDraft([draft[0], Math.max(Number(e.target.value), draft[0])])
          }
        />
      </div>
    </div>
  );
}

export function SegmentPicker({
  query,
  onChange,
  years,
  lengthBounds,
  selected,
  overlapM,
  onRemoveOverlaps,
}: SegmentPickerProps) {
  const unit = useUnit();
  return (
    <div className="segment-picker">
      <div className="filter-chips segments__filters">
        <Chips
          label="Segments"
          options={SETS}
          value={query.set}
          onSelect={(set) =>
            onChange(
              set === "custom" ? { set, seg: query.seg } : { set, seg: [] },
            )
          }
        />
        <LengthRange
          bounds={lengthBounds}
          min={query.min}
          max={query.max}
          onChange={(min, max) => onChange({ min, max })}
        />
        <Chips
          label="Direction"
          options={[
            { value: "south", label: "Southbound" },
            { value: "north", label: "Northbound" },
          ]}
          value={query.direction}
          onSelect={(direction) => onChange({ direction, seg: [] })}
        />
        <div className="filter-section">
          <label className="filter-section__label" htmlFor="segments-year">
            Time
          </label>
          <select
            id="segments-year"
            className="leaderboard__filter-select"
            value={query.year ?? ""}
            onChange={(e) =>
              onChange({ year: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">All time</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="segment-picker__summary">
        <span>
          <strong>{selected.count}</strong> segment
          {selected.count === 1 ? "" : "s"} ·{" "}
          {formatSegmentDistance(selected.distanceM, unit)} ·{" "}
          {unit === "km"
            ? `${Math.round(selected.climbM)} m`
            : `${Math.round(selected.climbM * 3.28084)} ft`}{" "}
          climbing
        </span>
        {overlapM > 0 && (
          <span className="segment-picker__overlap" role="status">
            {formatSegmentDistance(overlapM, unit)} counted twice{" "}
            <button
              type="button"
              className="segments__opt-out-btn"
              onClick={onRemoveOverlaps}
            >
              Remove overlaps
            </button>
          </span>
        )}
        {query.set !== "custom" && (
          <label className="segment-picker__overlap-toggle">
            <input
              type="checkbox"
              checked={query.overlap}
              onChange={(e) => onChange({ overlap: e.target.checked })}
            />{" "}
            Allow overlaps
          </label>
        )}
        <CopyLinkButton />
      </div>
    </div>
  );
}
