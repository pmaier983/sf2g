import { useMemo, useState } from "react";
import { seasonGrid, type SeasonDay } from "../../lib/race-season";
import {
  TRAVEL_MODES,
  formatTravelTime,
  type Travel,
} from "../../lib/race-travel";
import type { RaceEvent } from "../../lib/races";

export interface RaceSeasonGridProps {
  year: number;
  /** The events currently listed (already filtered). */
  events: RaceEvent[];
  travelById: Map<string, Travel | null>;
  /** Jump to an event's row. */
  onSelect: (eventId: string) => void;
}

const WEEKDAY_LABELS: [number, string][] = [
  [1, "Mon"],
  [3, "Wed"],
  [5, "Fri"],
];

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function describe(day: SeasonDay, travelById: Map<string, Travel | null>) {
  const races = day.events
    .map((e) => {
      const t = travelById.get(e.id);
      return t
        ? `${e.name} ${TRAVEL_MODES[t.mode].emoji} ${formatTravelTime(t.minutes, t.estimated)}`
        : e.name;
    })
    .join(" · ");
  return `${dayLabel(day.iso)}: ${races}`;
}

/**
 * GitHub-contribution-style calendar of the season: one square per day,
 * darker with more races. Clicking a square jumps to its race; clicking the
 * same square again steps to the next race that day.
 */
export function RaceSeasonGrid({
  year,
  events,
  travelById,
  onSelect,
}: RaceSeasonGridProps) {
  const grid = useMemo(() => seasonGrid(year, events), [year, events]);
  const [active, setActive] = useState<SeasonDay | null>(null);
  const [cursor, setCursor] = useState<{ iso: string; i: number } | null>(null);

  const raceDayCount = grid.weeks.flat().filter((d) => d.events.length).length;
  const unplaced = grid.undated.filter((e) => e.start !== null);
  const level = (n: number) =>
    n === 0 ? 0 : Math.min(4, Math.ceil((n / Math.max(grid.maxPerDay, 1)) * 4));

  const select = (day: SeasonDay) => {
    const i = cursor?.iso === day.iso ? (cursor.i + 1) % day.events.length : 0;
    setCursor({ iso: day.iso, i });
    onSelect(day.events[i].id);
  };

  return (
    <section className="race-season" aria-labelledby="race-season-title">
      <div className="race-season__head">
        <h2 className="race-season__title" id="race-season-title">
          {year} season
        </h2>
        <span className="race-season__summary">
          {raceDayCount} race days · click a square to jump to its race
        </span>
      </div>

      <div className="race-season__scroll">
        <div
          className="race-season__grid"
          role="group"
          aria-label={`${year} race calendar`}
          style={{
            gridTemplateColumns: `auto repeat(${grid.weeks.length}, var(--race-cell))`,
          }}
          onMouseLeave={() => setActive(null)}
        >
          {grid.months.map((m) => (
            <span
              key={m.label}
              className="race-season__month"
              style={{ gridColumn: m.week + 2, gridRow: 1 }}
              aria-hidden="true"
            >
              {m.label}
            </span>
          ))}
          {WEEKDAY_LABELS.map(([d, label]) => (
            <span
              key={label}
              className="race-season__weekday"
              style={{ gridColumn: 1, gridRow: d + 2 }}
              aria-hidden="true"
            >
              {label}
            </span>
          ))}
          {grid.weeks.map((week, w) =>
            week.map((day, d) => {
              const style = { gridColumn: w + 2, gridRow: d + 2 };
              if (!day.inYear) {
                return <span key={day.iso} style={style} aria-hidden="true" />;
              }
              const n = day.events.length;
              if (n === 0) {
                return (
                  <span
                    key={day.iso}
                    className="race-season__cell"
                    data-level={0}
                    style={style}
                    aria-hidden="true"
                  />
                );
              }
              const label = describe(day, travelById);
              return (
                <button
                  key={day.iso}
                  type="button"
                  className="race-season__cell"
                  data-level={level(n)}
                  data-day={day.iso}
                  style={style}
                  title={label}
                  aria-label={label}
                  onMouseEnter={() => setActive(day)}
                  onFocus={() => setActive(day)}
                  onClick={() => select(day)}
                />
              );
            }),
          )}
        </div>
      </div>

      <div className="race-season__foot">
        <p className="race-season__detail" aria-live="polite">
          {active
            ? describe(active, travelById)
            : "Hover a square to see its races; tap or click to jump to it."}
        </p>
        <span className="race-season__scale" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="race-season__cell" data-level={l} />
          ))}
          More
        </span>
      </div>
      {unplaced.length > 0 && (
        <p className="race-season__unplaced">
          Not on the grid (month only):{" "}
          {unplaced.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <a
                href={`#${e.id}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  onSelect(e.id);
                }}
              >
                {e.name}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
