import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
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

  return (
    <div className="segments">
      <div className="container">
        <header className="segments__header">
          <h1 className="segments__title">Skyline Segments</h1>
          <p className="segments__subtitle">
            Best times of opted-in SF2G riders on the Strava segments along
            Skyline Blvd, from their own rides.
          </p>
        </header>

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
          />
        </section>
      </div>
    </div>
  );
}
