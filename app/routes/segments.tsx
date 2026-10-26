import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useState } from "react";
import { segmentLeaderboardQueryOptions } from "../queries/segments";
import {
  parseSegmentSearch,
  serializeSegmentSearch,
  type SegmentQuery,
} from "../lib/segment-query";
import { SegmentFilters } from "../components/SegmentFilters";
import { SegmentOptInBanner } from "../components/SegmentOptInBanner";
import { SegmentCrownTable } from "../components/SegmentCrownTable";
import { SegmentBoard } from "../components/SegmentBoard";
import { CorridorTabs } from "../components/CorridorTabs";
import { RouteViewSkeleton } from "../components/RouteViewSkeleton";
const RouteView = lazy(() => import("../components/RouteView"));
import "../styles/leaderboard.css";
import "../styles/segments.css";

export const Route = createFileRoute("/segments")({
  validateSearch: (raw: Record<string, unknown>): SegmentQuery =>
    parseSegmentSearch(raw),
  search: {
    // Keep URLs short: drop defaults.
    middlewares: [
      ({ search, next }) =>
        serializeSegmentSearch(
          parseSegmentSearch(next(search)),
        ) as unknown as SegmentQuery,
    ],
  },
  component: SegmentsPage,
  head: () => ({
    meta: [
      { title: "Skyline Segments — SF2G" },
      {
        name: "description",
        content:
          "Fastest SF2G riders on the Strava segments along Skyline Blvd, and the Skyline crown.",
      },
    ],
  }),
});

function SegmentsPage() {
  const query = Route.useSearch();
  const navigate = useNavigate({ from: "/segments" });
  const update = useCallback(
    (patch: Partial<SegmentQuery>) =>
      navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate],
  );

  const { data, isLoading, error, refetch } = useQuery({
    ...segmentLeaderboardQueryOptions(query),
    placeholderData: keepPreviousData,
  });

  // Shared by the route view and the board.
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    id: number;
    n: number;
  } | null>(null);
  const pickOnRoute = useCallback((id: number) => {
    setSelectedId(id);
    setFocusRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
  }, []);

  return (
    <div className="segments">
      <div className="container">
        <header className="segments__header">
          <h1 className="segments__title">Skyline Segments</h1>
          <p className="segments__subtitle">
            Best times of opted-in SF2G riders on the Strava segments of the
            core Skyline route, Mussel Rock to Arastradero Rd, from their own
            rides.
          </p>
        </header>

        <CorridorTabs
          corridor={query.corridor}
          onChange={(corridor) => update({ corridor })}
        />
        <Suspense fallback={<RouteViewSkeleton />}>
          {data ? (
            <RouteView
              corridor={query.corridor}
              segments={data.segments}
              hoveredId={hoveredId}
              selectedId={selectedId}
              onHover={setHoveredId}
              onSelect={pickOnRoute}
            />
          ) : (
            <RouteViewSkeleton />
          )}
        </Suspense>

        <SegmentFilters query={query} onChange={update} />
        <SegmentOptInBanner />

        <section className="segments__section" aria-labelledby="crown-title">
          <h2 id="crown-title" className="segments__section-title">
            Skyline crown
          </h2>
          <SegmentCrownTable
            crown={data?.crown}
            isLoading={isLoading}
            error={error}
            onRetry={() => refetch()}
          />
        </section>

        <section className="segments__section" aria-labelledby="board-title">
          <h2 id="board-title" className="segments__section-title">
            Segment board
            {data && (
              <span className="segments__count">
                {data.segments_total} segments
              </span>
            )}
          </h2>
          <SegmentBoard
            segments={data?.segments}
            isLoading={isLoading}
            error={error}
            onRetry={() => refetch()}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onSelect={setSelectedId}
            focusRequest={focusRequest}
          />
        </section>
      </div>
    </div>
  );
}
