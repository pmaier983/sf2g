import { useState } from "react";
import {
  STATUS_BADGES,
  formatDateRange,
  formatDistance,
  monthDay,
  monthShort,
  raceDate,
  sourceEntries,
  terrainOf,
  weekdayShortOf,
  type DistanceUnit,
  type RaceEvent,
  type RaceSource,
} from "../../lib/races";
import {
  TRAVEL_MODES,
  formatTravelTime,
  type Travel,
} from "../../lib/race-travel";
import { TERRAIN_KINDS } from "../../lib/race-terrain";
import { RaceCourseViz } from "./RaceCourseViz";

/** Emoji + mode, time for that mode, road distance in the chosen unit. */
function TravelBlock({ travel, unit }: { travel: Travel; unit: DistanceUnit }) {
  const mode = TRAVEL_MODES[travel.mode];
  const dist = formatDistance(travel.roadMi, unit);
  return (
    <div
      className={`race-row__drive race-row__drive--${travel.mode}`}
      aria-label={`${mode.label}, ${formatTravelTime(travel.minutes, travel.estimated)}, ${dist.value} ${dist.unit}`}
    >
      <div className="race-row__mode">
        <span className="race-row__mode-emoji" aria-hidden="true">
          {mode.emoji}
        </span>{" "}
        {mode.label}
      </div>
      <div className="race-row__drive-mi">
        {formatTravelTime(travel.minutes, travel.estimated)}
      </div>
      <div className="race-row__drive-time">
        {dist.value} {dist.unit}
      </div>
    </div>
  );
}

function DateBlock({ event }: { event: RaceEvent }) {
  if (!event.start) {
    return (
      <div className="race-row__date">
        <div className="race-row__month">2027</div>
        <div className="race-row__tba">TBA</div>
      </div>
    );
  }
  if (event.dateStatus === "month") {
    return (
      <div className="race-row__date">
        <div className="race-row__month">{monthShort(event.start)}</div>
        <div className="race-row__tba">TBA</div>
      </div>
    );
  }
  const multiDay = event.end !== null && event.end !== event.start;
  return (
    <div className="race-row__date">
      <div className="race-row__month">{monthShort(event.start)}</div>
      <div className="race-row__day">{raceDate(event.start).getDate()}</div>
      <div className="race-row__weekday">
        {multiDay
          ? `to ${monthDay(event.end as string)}`
          : weekdayShortOf(event.start)}
      </div>
    </div>
  );
}

function SourceLink({ source }: { source: RaceSource }) {
  return (
    <span className="race-row__source">
      <b>{source.what}:</b>{" "}
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          {source.label}
        </a>
      ) : (
        source.label
      )}
    </span>
  );
}

function typeTagClass(type: RaceEvent["type"]): string {
  if (type === "Road race") return "race-tag race-tag--road";
  if (type === "Stage race") return "race-tag race-tag--stage";
  return "race-tag";
}

export interface RaceRowProps {
  event: RaceEvent;
  /** Null when the venue is not known yet. */
  travel: Travel | null;
  unit: DistanceUnit;
  /** Origin label when travel is an estimate rather than the SF OSRM drive. */
  estimatedFrom?: string;
  /** Briefly highlight the row (jumped to from the season grid). */
  flash?: boolean;
}

/** One event: date | name, details, course, sources | travel. */
export function RaceRow({
  event,
  travel,
  unit,
  estimatedFrom,
  flash = false,
}: RaceRowProps) {
  const badge = STATUS_BADGES[event.dateStatus];
  const terrain = terrainOf(event);
  const sources = sourceEntries(event, estimatedFrom);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const where = [event.city, event.state].filter(Boolean).join(", ");
  const extraDates =
    event.dates && event.dates.length > 1
      ? event.dates.slice(1).map(monthDay).join(", ")
      : null;
  const previous =
    event.section === "stage" &&
    event.dateStatus === "tba" &&
    event.previousEdition
      ? formatDateRange(event.previousEdition.start, event.previousEdition.end)
      : null;

  return (
    <article
      className={`race-row${flash ? " race-row--flash" : ""}`}
      id={event.id}
      tabIndex={-1}
    >
      <DateBlock event={event} />

      <div className="race-row__main">
        <div className="race-row__title">
          <h3 className="race-row__name">{event.name}</h3>
          <span className={typeTagClass(event.type)}>{event.type}</span>
          {terrain && (
            <span
              className={`race-tag race-tag--terrain race-tag--terrain-${terrain.kind}`}
              title={TERRAIN_KINDS[terrain.kind].rule}
            >
              <span aria-hidden="true">
                {TERRAIN_KINDS[terrain.kind].emoji}
              </span>{" "}
              {TERRAIN_KINDS[terrain.kind].label}
            </span>
          )}
          {badge && <span className="race-tag race-tag--status">{badge}</span>}
          <span className="race-row__where">
            {where}
            {extraDates && ` · also ${extraDates}`}
          </span>
        </div>

        {event.section === "stage" ? (
          <>
            {(event.format || previous) && (
              <p className="race-row__note">
                {event.format && <b>{event.format}</b>}
                {event.format && previous && " · "}
                {previous && `2026 edition ran ${previous}`}
              </p>
            )}
            {event.stages && event.stages.length > 0 && (
              <ul className="race-row__stages">
                {event.stages.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {event.notes && <p className="race-row__note">{event.notes}</p>}
            {event.course ? (
              <RaceCourseViz course={event.course} unit={unit} />
            ) : (
              <div className="race-row__no-course">
                No public GPS file found for this course yet.
              </div>
            )}
          </>
        )}

        {/* Phones: sources fold behind a toggle; desktop shows them inline. */}
        <button
          type="button"
          className="race-row__sources-toggle"
          aria-expanded={sourcesOpen}
          aria-controls={`${event.id}-sources`}
          onClick={() => setSourcesOpen((o) => !o)}
        >
          Sources ({sources.length}) {sourcesOpen ? "▴" : "▾"}
        </button>
        <div
          id={`${event.id}-sources`}
          className={`race-row__sources${sourcesOpen ? " race-row__sources--open" : ""}`}
        >
          {sources.map((s, i) => (
            <SourceLink key={`${s.what}-${i}`} source={s} />
          ))}
        </div>
      </div>

      {travel ? (
        <TravelBlock travel={travel} unit={unit} />
      ) : (
        <div className="race-row__drive race-row__drive--unknown">
          <div className="race-row__mode">📍 Venue TBA</div>
        </div>
      )}
    </article>
  );
}
