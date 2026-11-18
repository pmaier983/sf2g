/**
 * /segments — cumulative segment leaderboards for the SF2G routes (phase 09).
 *
 * One request per route, direction and year (get_segment_matrix); everything
 * else — presets, the length range, manual picks, totals, ranks, boards and
 * the crown — is computed in the browser from that matrix.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { trackEvent } from "../lib/analytics";
import { segmentMatrixQueryOptions } from "../queries/segments";
import { currentUserQueryOptions } from "../queries/user";
import {
  parseCumulativeSearch,
  serializeCumulativeSearch,
  type CumulativeQuery,
  type SegmentView,
} from "../lib/segment-query";
import {
  buildMatrix,
  crown,
  cumulative,
  overlapMeters,
  resolveChain,
  segmentBoard,
  selectSegments,
} from "../lib/segment-cumulative";
import { SEGMENT_CORRIDORS } from "../lib/constants";
import type { RouteSegment } from "../lib/route-segment";
import { CorridorTabs } from "../components/CorridorTabs";
import { RouteViewSkeleton } from "../components/RouteViewSkeleton";
import { SegmentPicker } from "../components/SegmentPicker";
import { SegmentVisibility } from "../components/SegmentVisibility";
import { CumulativeBoard } from "../components/CumulativeBoard";
import { CumulativeStats } from "../components/CumulativeStats";
import { SegmentBoards } from "../components/SegmentBoards";
import { SegmentCrownView } from "../components/SegmentCrownView";
import { TableError } from "../components/table/TableStates";
const RouteView = lazy(() => import("../components/RouteView"));
import "../styles/leaderboard.css";
import "../styles/segments.css";

export const Route = createFileRoute("/segments")({
  validateSearch: (raw: Record<string, unknown>): CumulativeQuery =>
    parseCumulativeSearch(raw),
  search: {
    // Keep URLs short: drop defaults.
    middlewares: [
      ({ search, next }) =>
        serializeCumulativeSearch(
          parseCumulativeSearch(next(search)),
        ) as unknown as CumulativeQuery,
    ],
  },
  component: SegmentsPage,
  head: () => ({
    meta: [
      { title: "Segments — SF2G" },
      {
        name: "description",
        content:
          "Cumulative segment leaderboards for the SF2G routes: every rider's best times on the core segments, added up, plus per-segment boards and Strava KOMs held by SF2G riders.",
      },
    ],
  }),
});

const VIEWS: { value: SegmentView; label: string }[] = [
  { value: "cumulative", label: "Cumulative" },
  { value: "segments", label: "Segments" },
  { value: "crown", label: "Crown" },
];

function SegmentsPage() {
  const query = Route.useSearch();
  const navigate = useNavigate({ from: "/segments" });
  const update = useCallback(
    (patch: Partial<CumulativeQuery>) => {
      if (
        "set" in patch ||
        "seg" in patch ||
        "min" in patch ||
        "max" in patch ||
        "overlap" in patch
      )
        trackEvent("segment_set_changed", {
          set: patch.set,
          segments: patch.seg?.length,
          min_km: patch.min,
          max_km: patch.max,
        });
      return navigate({
        search: (prev) => ({ ...prev, ...patch }) as CumulativeQuery,
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );
  // One event per route / direction / year / view the visitor looks at.
  useEffect(() => {
    trackEvent("segments_viewed", {
      corridor: query.corridor,
      direction: query.direction,
      year: query.year,
      set: query.set,
      view: query.view,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.corridor, query.direction, query.year, query.view]);

  const { data, isLoading, error, refetch } = useQuery({
    ...segmentMatrixQueryOptions(query),
    placeholderData: keepPreviousData,
  });
  const { data: me } = useQuery(currentUserQueryOptions());

  const matrix = useMemo(() => (data ? buildMatrix(data) : null), [data]);
  const selected = useMemo(
    () =>
      matrix
        ? selectSegments(matrix.segments, {
            set: query.set,
            minKm: query.min,
            maxKm: query.max,
            ids: query.seg,
            overlap: query.overlap,
          })
        : [],
    [matrix, query.set, query.min, query.max, query.seg, query.overlap],
  );
  const selectedIds = useMemo(() => selected.map((s) => s.id), [selected]);
  const included = useMemo(() => new Set(selectedIds), [selectedIds]);
  const result = useMemo(
    () => (matrix ? cumulative(matrix, selectedIds) : null),
    [matrix, selectedIds],
  );
  const crownRows = useMemo(
    () => (matrix ? crown(matrix, selectedIds) : []),
    [matrix, selectedIds],
  );
  const routeSegments = useMemo<RouteSegment[]>(
    () =>
      matrix
        ? matrix.segments.map((s) => {
            const lead = segmentBoard(matrix, s.id)[0];
            return {
              id: s.id,
              name: s.name,
              distance_meters: s.distance_meters,
              average_grade: s.average_grade,
              terrain: s.terrain,
              start_latlng: s.start_latlng,
              end_latlng: s.end_latlng,
              kom_seconds: s.overall_seconds ?? s.kom_seconds,
              leader: lead
                ? {
                    display_name: lead.rider.display_name,
                    best_seconds: lead.cell.seconds,
                  }
                : null,
            };
          })
        : [],
    [matrix],
  );
  const lengthBounds = useMemo<[number, number]>(() => {
    const d = matrix?.segments.map((s) => s.distance_meters / 1000) ?? [];
    return d.length ? [Math.min(...d), Math.max(...d)] : [0, 10];
  }, [matrix]);

  // Manual picks turn any preset into an explicit custom selection.
  const toggle = useCallback(
    (id: number) => {
      const next = included.has(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      update({ set: "custom", seg: next });
    },
    [included, selectedIds, update],
  );
  const removeOverlaps = useCallback(
    () =>
      update({
        set: "custom",
        seg: resolveChain(selected).map((s) => s.id),
      }),
    [selected, update],
  );

  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const label = SEGMENT_CORRIDORS[query.corridor].label;

  return (
    <div className="segments">
      <div className="container">
        <header className="segments__header">
          <h1 className="segments__title">{label} Segments</h1>
          <p className="segments__subtitle">
            Every SF2G rider's best time on each segment of the core {label}{" "}
            route, added up. Pick the segments that count: a preset, a length
            range, or tap them on the profile.
          </p>
        </header>

        <CorridorTabs
          corridor={query.corridor}
          onChange={(corridor) => update({ corridor, set: "core", seg: [] })}
        />
        <Suspense fallback={<RouteViewSkeleton />}>
          {matrix ? (
            <RouteView
              corridor={query.corridor}
              segments={routeSegments}
              included={included}
              hoveredId={hoveredId}
              selectedId={null}
              onHover={setHoveredId}
              onSelect={toggle}
            />
          ) : (
            <RouteViewSkeleton />
          )}
        </Suspense>

        <SegmentPicker
          query={query}
          onChange={update}
          years={data?.years ?? []}
          lengthBounds={lengthBounds}
          selected={{
            count: result?.segments.length ?? 0,
            distanceM: result?.distance_m ?? 0,
            climbM: result?.climb_m ?? 0,
          }}
          overlapM={overlapMeters(selected)}
          onRemoveOverlaps={removeOverlaps}
        />
        <SegmentVisibility />

        <div
          className="filter-chips__group segments__views"
          role="tablist"
          aria-label="View"
        >
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={query.view === v.value}
              className={`filter-chip filter-chip--company${query.view === v.value ? " filter-chip--selected" : ""}`}
              onClick={() => update({ view: v.value })}
            >
              {v.label}
            </button>
          ))}
        </div>

        {error && !data ? (
          <TableError error={error as Error} onRetry={() => refetch()} />
        ) : isLoading || !matrix || !result ? (
          <p className="segments__loading" aria-busy="true">
            Loading segments…
          </p>
        ) : (
          <section className="segments__section" aria-label={query.view}>
            {query.view === "cumulative" && (
              <>
                <CumulativeStats
                  matrix={matrix}
                  result={result}
                  routeLabel={label}
                />
                <CumulativeBoard
                  matrix={matrix}
                  result={result}
                  meId={me?.id ?? null}
                />
              </>
            )}
            {query.view === "segments" && (
              <SegmentBoards
                matrix={matrix}
                included={included}
                onToggle={toggle}
                hoveredId={hoveredId}
                onHover={setHoveredId}
              />
            )}
            {query.view === "crown" && <SegmentCrownView rows={crownRows} />}
          </section>
        )}
      </div>
    </div>
  );
}
