import {
  SECTION_FILTERS,
  SECTION_LABELS,
  TYPE_FILTERS,
  filterAndSortRaces,
  sectionCounts,
  summarizeRaces,
  type RaceSort,
  type RacesFile,
  type RacesSearch,
  type SectionFilter,
  type TypeFilter,
} from "../../lib/races";
import { RaceRow } from "./RaceRow";

export interface RacesPageContentProps {
  data: RacesFile;
  search: RacesSearch;
  onSearchChange: (next: Partial<RacesSearch>) => void;
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`filter-chip filter-chip--company${selected ? " filter-chip--selected" : ""}`}
      role="radio"
      aria-checked={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Everything below the page title once the JSON has loaded: counts, filters,
 * the dated list, the "no 2027 date yet" list and the methodology section.
 * Pure props in, so tests can render it with the real data file.
 */
export function RacesPageContent({
  data,
  search,
  onSearchChange,
}: RacesPageContentProps) {
  const summary = summarizeRaces(data.events);
  const counts = sectionCounts(data.events);
  const { dated, tba } = filterAndSortRaces(data.events, search);

  return (
    <>
      <div className="races-page__keys" aria-label="Summary">
        <span>
          <b>{summary.californiaEvents}</b> California events
        </span>
        <span>
          <b>{summary.californiaRoadRaces}</b> CA road races
        </span>
        <span>
          <b>{summary.stageRacesDated}</b> stage races dated for 2027
        </span>
        <span>
          <b>{summary.coursesMapped}</b> courses mapped
        </span>
        <a href="#races-sources">Where this data comes from</a>
      </div>

      <div
        className="races-page__bar"
        role="toolbar"
        aria-label="Filter events"
      >
        <div
          className="races-page__chips"
          role="radiogroup"
          aria-label="Region"
        >
          {SECTION_FILTERS.map((s: SectionFilter) => (
            <Chip
              key={s}
              selected={search.section === s}
              onClick={() => onSearchChange({ section: s })}
            >
              {s === "all" ? "All" : SECTION_LABELS[s]} {counts[s]}
            </Chip>
          ))}
        </div>
        <div
          className="races-page__chips"
          role="radiogroup"
          aria-label="Event type"
        >
          {TYPE_FILTERS.map((t: TypeFilter) => (
            <Chip
              key={t}
              selected={search.type === t}
              onClick={() => onSearchChange({ type: t })}
            >
              {t === "all" ? "All types" : t}
            </Chip>
          ))}
        </div>
        <label className="races-page__sort">
          Sort
          <select
            value={search.sort}
            onChange={(e) =>
              onSearchChange({ sort: e.target.value as RaceSort })
            }
            aria-label="Sort events"
          >
            <option value="date">Date</option>
            <option value="drive">Drive distance</option>
          </select>
        </label>
      </div>

      {dated.length === 0 && tba.length === 0 ? (
        <p className="races-page__empty">No events match these filters.</p>
      ) : null}

      {dated.length > 0 && (
        <div className="races-page__list">
          {dated.map((e) => (
            <RaceRow key={e.id} event={e} />
          ))}
        </div>
      )}

      {tba.length > 0 && (
        <section className="races-page__tba">
          <h2 className="races-page__h2">
            Stage races without a 2027 date yet
          </h2>
          <p className="races-page__foot">
            These ran in 2026. Dates usually appear in winter; the 2026 dates
            are shown for reference.
          </p>
          <div className="races-page__list">
            {tba.map((e) => (
              <RaceRow key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}

      <section className="races-page__method surface-card" id="races-sources">
        <h2 className="races-page__h2">Where this data comes from</h2>
        <dl className="races-page__method-list">
          {data.methodology.map((m) => (
            <div key={m.topic} className="races-page__method-item">
              <dt>{m.topic}</dt>
              <dd>
                {m.text}{" "}
                <a href={m.url} target="_blank" rel="noopener noreferrer">
                  Source
                </a>
              </dd>
            </div>
          ))}
        </dl>
        <p className="races-page__foot">
          Compiled {data.generatedOn}. Calendars change; check each race&apos;s
          own page before you register.
        </p>
      </section>
    </>
  );
}
