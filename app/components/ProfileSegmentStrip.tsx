/**
 * Profile strip (phase 09f): where this rider stands on each route's
 * cumulative leaderboard (Core preset, all time), with their KOM honours.
 * Uses the same cached matrix query as /segments: one request per route,
 * shared with the page.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { SEGMENT_CORRIDORS, type SegmentCorridor } from "../lib/constants";
import {
  buildMatrix,
  cumulative,
  selectSegments,
} from "../lib/segment-cumulative";
import { formatSegmentTime } from "../lib/segment-format";
import { segmentMatrixQueryOptions } from "../queries/segments";
import { HonourCounts } from "./SegmentHonours";

function RouteLine({
  corridor,
  userId,
}: {
  corridor: SegmentCorridor;
  userId: string;
}) {
  const { data } = useQuery(
    segmentMatrixQueryOptions({ corridor, direction: "south", year: null }),
  );
  const line = useMemo(() => {
    if (!data) return null;
    const m = buildMatrix(data);
    const ids = selectSegments(m.segments, {
      set: "core",
      minKm: null,
      maxKm: null,
    }).map((s) => s.id);
    const r = cumulative(m, ids);
    const ranked = r.ranked.find((x) => x.rider.user_id === userId);
    const partial = r.partial.find((x) => x.rider.user_id === userId);
    if (ranked)
      return {
        ranked,
        partial: null,
        of: r.ranked.length,
        required: r.required,
      };
    if (partial)
      return {
        ranked: null,
        partial,
        of: r.ranked.length,
        required: r.required,
      };
    return null;
  }, [data, userId]);

  if (!line) return null;
  const label = SEGMENT_CORRIDORS[corridor].label;
  const row = line.ranked ?? line.partial!;
  return (
    <li className="profile-segments__item">
      <Link
        to="/segments"
        search={{ corridor } as never}
        className="profile-segments__route"
      >
        {label} core
      </Link>
      {line.ranked ? (
        <span>
          <strong>
            #{line.ranked.rank} of {line.of}
          </strong>{" "}
          · {formatSegmentTime(line.ranked.total_seconds)}
        </span>
      ) : (
        <span>
          {row.done} of {row.of} segments ridden ({line.required} needed to
          rank)
        </span>
      )}
      <HonourCounts stravaKoms={row.strava_koms} records={row.sf2g_records} />
    </li>
  );
}

export function ProfileSegmentStrip({ userId }: { userId: string }) {
  const corridors = Object.keys(SEGMENT_CORRIDORS) as SegmentCorridor[];
  return (
    <ul className="profile-segments" aria-label="Segment leaderboards">
      {corridors.map((c) => (
        <RouteLine key={c} corridor={c} userId={userId} />
      ))}
    </ul>
  );
}
