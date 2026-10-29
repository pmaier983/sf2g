import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RACE_SORTS,
  SECTION_FILTERS,
  SECTION_LABELS,
  TERRAIN_FILTERS,
  TYPE_FILTERS,
  filterAndSortRaces,
  sectionCounts,
  summarizeRaces,
  terrainCounts,
  type DistanceUnit,
  type TerrainFilter,
  type RacesFile,
  type RacesSearch,
  type SectionFilter,
  type TypeFilter,
} from "../../lib/races";
import {
  TRAVEL_MODE_ORDER,
  estimateTravel,
  type Origin,
  type Travel,
  type TravelMode,
} from "../../lib/race-travel";
import { TERRAIN_KINDS } from "../../lib/race-terrain";
import { RaceRow } from "./RaceRow";
import { RaceOriginPicker } from "./RaceOriginPicker";
import { RaceSeasonGrid } from "./RaceSeasonGrid";

/** The season the data file covers. */
export const RACES_SEASON = 2027;
const FLASH_MS = 3000;

export interface RacesPageContentProps {
  data: RacesFile;
  search: RacesSearch;
  onSearchChange: (next: Partial<RacesSearch>) => void;
  origin: Origin;
  onOriginChange: (origin: Origin) => void;
  unit: DistanceUnit;
}

function Chip({
  selected,
  onClick,
  children,
  title,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
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
 * Everything below the page title once the JSON has loaded: counts, the
 * "From" origin, filters, the season grid, the dated list, the "no 2027 date
 * yet" list and the methodology section. Pure props in, so tests can render
 * it with the real data file.
 */
export function RacesPageContent({
  data,
  search,
  onSearchChange,
  origin,
  onOriginChange,
  unit,
}: RacesPageContentProps) {
  const summary = summarizeRaces(data.events);
  const counts = sectionCounts(data.events);
  const terrain = useMemo(() => terrainCounts(data.events), [data.events]);

  const travelById = useMemo(() => {
    const m = new Map<string, Travel | null>();
    for (const e of data.events) m.set(e.id, estimateTravel(e, origin));
    return m;
  }, [data.events, origin]);

  const { dated, tba } = useMemo(
    () =>
      filterAndSortRaces(data.events, search, {
        distanceOf: (e) => travelById.get(e.id)?.roadMi,
        minutesOf: (e) => travelById.get(e.id)?.minutes,
      }),
    [data.events, search, travelById],
  );
  const listed = useMemo(() => [...dated, ...tba], [dated, tba]);

  const filtersId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [
    search.section !== "all",
    search.type !== "all",
    search.terrain !== "all",
  ].filter(Boolean).length;
  const sortLabel =
    RACE_SORTS.find((o) => o.value === search.sort)?.label ?? "Date";

  const modeCounts = useMemo(() => {
    const c = Object.fromEntries(
      TRAVEL_MODE_ORDER.map((m) => [m, 0]),
    ) as Record<TravelMode, number>;
    for (const e of listed) {
      const t = travelById.get(e.id);
      if (t) c[t.mode]++;
    }
    return c;
  }, [listed, travelById]);

  // Season-grid jump: scroll the row into view and flash it.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Smooth only for short hops; a long smooth scroll would arrive after
    // the highlight has faded.
    const far =
      Math.abs(el.getBoundingClientRect().top) > window.innerHeight * 3;
    el.scrollIntoView({
      // "auto" would defer to html { scroll-behavior: smooth } in global.css.
      behavior: reduce || far ? "instant" : "smooth",
      block: "center",
    });
    el.focus({ preventScroll: true });
    // Clear first so clicking the same race again restarts the animation.
    setFlashId(null);
    requestAnimationFrame(() => setFlashId(id));
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), FLASH_MS);
  }, []);

  const estimatedFrom = origin.exact ? undefined : origin.label;
  const row = (e: (typeof listed)[number]) => (
    <RaceRow
      key={e.id}
      event={e}
      travel={travelById.get(e.id) ?? null}
      unit={unit}
      estimatedFrom={estimatedFrom}
      flash={flashId === e.id}
    />
  );

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

      <RaceOriginPicker
        origin={origin}
        onOriginChange={onOriginChange}
        modeCounts={modeCounts}
        unit={unit}
      />

      <div
        className="races-page__bar"
        role="toolbar"
        aria-label="Filter events"
      >
        {/* Phones: one summary button instead of four rows of chips. */}
        <button
          type="button"
          className="races-page__filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls={filtersId}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <span className="races-page__filters-toggle-label">
            <span aria-hidden="true">⚙️</span> Filters
            {activeFilters > 0 && (
              <span className="races-page__filters-count">
                {" "}
                · {activeFilters} {activeFilters === 1 ? "filter" : "filters"}
              </span>
            )}
          </span>
          <span className="races-page__filters-toggle-meta">
            {listed.length} races · {sortLabel}
          </span>
          <span className="races-page__filters-caret" aria-hidden="true">
            {filtersOpen ? "▴" : "▾"}
          </span>
        </button>
        <div
          id={filtersId}
          className={`races-page__filters${filtersOpen ? " races-page__filters--open" : ""}`}
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
          <div
            className="races-page__chips"
            role="radiogroup"
            aria-label="Terrain"
          >
            {TERRAIN_FILTERS.map((t: TerrainFilter) => (
              <Chip
                key={t}
                selected={search.terrain === t}
                onClick={() => onSearchChange({ terrain: t })}
                title={t === "all" ? undefined : TERRAIN_KINDS[t].rule}
              >
                {t === "all" ? (
                  "All terrain"
                ) : (
                  <>
                    <span aria-hidden="true">{TERRAIN_KINDS[t].emoji}</span>{" "}
                    {TERRAIN_KINDS[t].label} {terrain[t]}
                  </>
                )}
              </Chip>
            ))}
          </div>
          <div
            className="races-page__chips races-page__sort"
            role="radiogroup"
            aria-label="Sort by"
          >
            <span className="races-page__sort-label" aria-hidden="true">
              Sort
            </span>
            {RACE_SORTS.map((o) => (
              <Chip
                key={o.value}
                selected={search.sort === o.value}
                onClick={() => onSearchChange({ sort: o.value })}
                title={
                  o.value === "drive" || o.value === "time"
                    ? `From ${origin.label}`
                    : undefined
                }
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <RaceSeasonGrid
        year={RACES_SEASON}
        events={listed}
        travelById={travelById}
        onSelect={jumpTo}
      />

      {dated.length === 0 && tba.length === 0 ? (
        <p className="races-page__empty">No events match these filters.</p>
      ) : null}

      {dated.length > 0 && (
        <div className="races-page__list">{dated.map(row)}</div>
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
          <div className="races-page__list">{tba.map(row)}</div>
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
          <div className="races-page__method-item">
            <dt>Travel estimates</dt>
            <dd>
              From San Francisco, the OSRM drive above. From anywhere else,
              straight-line distance × 1.2 for roads and highway-pace driving
              (55 mph), fitted to those OSRM drives. Bike assumes 14 mph and
              ignores water crossings; flights add 2.5 h of airports to air time
              at 450 mph. A chosen location stays in this browser.
            </dd>
          </div>
        </dl>
        <p className="races-page__foot">
          Compiled {data.generatedOn}. Calendars change; check each race&apos;s
          own page before you register.
        </p>
      </section>
    </>
  );
}
