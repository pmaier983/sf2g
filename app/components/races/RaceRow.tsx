import {
  STATUS_BADGES,
  formatDateRange,
  formatDriveMinutes,
  isLikelyFlight,
  monthDay,
  monthShort,
  raceDate,
  sourceEntries,
  weekdayShortOf,
  type RaceEvent,
  type RaceSource,
} from "../../lib/races";
import { RaceCourseViz } from "./RaceCourseViz";

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

/** One event: date | name, details, course, sources | drive. */
export function RaceRow({ event }: { event: RaceEvent }) {
  const badge = STATUS_BADGES[event.dateStatus];
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
    <article className="race-row" id={event.id}>
      <DateBlock event={event} />

      <div className="race-row__main">
        <div className="race-row__title">
          <h3 className="race-row__name">{event.name}</h3>
          <span className={typeTagClass(event.type)}>{event.type}</span>
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
              <RaceCourseViz course={event.course} />
            ) : (
              <div className="race-row__no-course">
                No public GPS file found for this course yet.
              </div>
            )}
          </>
        )}

        <div className="race-row__sources">
          {sourceEntries(event).map((s, i) => (
            <SourceLink key={`${s.what}-${i}`} source={s} />
          ))}
        </div>
      </div>

      {event.drive && (
        <div className="race-row__drive">
          <div className="race-row__drive-mi">
            {event.drive.mi.toLocaleString("en-US")}
            <small> mi</small>
          </div>
          <div className="race-row__drive-time">
            {formatDriveMinutes(event.drive.min)}
          </div>
          {isLikelyFlight(event.drive) && (
            <div className="race-row__drive-fly">likely a flight</div>
          )}
        </div>
      )}
    </article>
  );
}
