/**
 * Filters for /segments: terrain and direction chips and a date preset.
 * Every value lives in the URL (SegmentQuery).
 */
import type {
  SegmentDirectionFilter,
  SegmentQuery,
  SegmentRange,
  SegmentTerrainFilter,
} from "../lib/segment-query";

const TERRAIN: { value: SegmentTerrainFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "climb", label: "Climbs" },
  { value: "flat", label: "Flats" },
];

const DIRECTION: { value: SegmentDirectionFilter; label: string }[] = [
  { value: "south", label: "Southbound" },
  { value: "north", label: "Northbound" },
  { value: "both", label: "Both" },
];

const RANGES: { value: SegmentRange; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "this-year", label: "This Year" },
  { value: "last-365-days", label: "Last 365 Days" },
  { value: "last-6-months", label: "Last 6 Months" },
  { value: "this-month", label: "This Month" },
  { value: "last-30-days", label: "Last 30 Days" },
  { value: "this-week", label: "This Week" },
];

export interface SegmentFiltersProps {
  query: SegmentQuery;
  onChange: (patch: Partial<SegmentQuery>) => void;
}

function ChipGroup<V extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onSelect: (v: V) => void;
}) {
  return (
    <div className="filter-section">
      <span className="filter-section__label">{label}</span>
      <div className="filter-chips__group" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              className={`filter-chip filter-chip--company${selected ? " filter-chip--selected" : ""}`}
              role="radio"
              aria-checked={selected}
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

export function SegmentFilters({ query, onChange }: SegmentFiltersProps) {
  return (
    <div className="filter-chips segments__filters">
      <ChipGroup
        label="Terrain"
        options={TERRAIN}
        value={query.terrain}
        onSelect={(terrain) => onChange({ terrain })}
      />
      <ChipGroup
        label="Direction"
        options={DIRECTION}
        value={query.direction}
        onSelect={(direction) => onChange({ direction })}
      />
      <div className="filter-section">
        <label className="filter-section__label" htmlFor="segments-range">
          Time
        </label>
        <select
          id="segments-range"
          className="leaderboard__filter-select"
          value={query.range}
          onChange={(e) => onChange({ range: e.target.value as SegmentRange })}
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
