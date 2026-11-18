/**
 * Stat cards above the cumulative leaderboard (phase 09, §6) and the banner
 * of SF2G riders who hold a Strava KOM on this route.
 */
import type { CumulativeResult, Matrix } from "../lib/segment-cumulative";
import { segmentBoard } from "../lib/segment-cumulative";
import { formatSegmentTime } from "../lib/segment-format";
import { SegmentRider } from "./SegmentRider";
import { StravaKomCrown } from "./SegmentHonours";

export function CumulativeStats({
  matrix,
  result,
  routeLabel,
}: {
  matrix: Matrix;
  result: CumulativeResult;
  routeLabel: string;
}) {
  const leader = result.ranked[0];
  const second = result.ranked[1];
  const topHolder = result.dream.holders[0];

  // Every current Strava KOM held by an SF2G rider among the selectable
  // segments of this route (not only the selected ones: it is rare).
  const komHolders = matrix.segments.flatMap((s) => {
    const row = segmentBoard(matrix, s.id).find((r) => r.honours.stravaKom);
    return row ? [{ segment: s, row }] : [];
  });

  return (
    <>
      {komHolders.length > 0 && (
        <div className="kom-banner" role="note">
          <span className="kom-banner__title">
            <StravaKomCrown /> Strava KOMs held by SF2G riders on {routeLabel}
          </span>
          <ul className="kom-banner__list">
            {komHolders.map(({ segment, row }) => (
              <li key={segment.id}>
                <SegmentRider
                  userId={row.rider.user_id}
                  displayName={row.rider.display_name}
                  avatarUrl={row.rider.avatar_url}
                />
                <span className="kom-banner__segment">
                  {segment.name} · {formatSegmentTime(row.cell.seconds)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="segment-stats">
        <div className="segment-stats__card">
          <dt>Riders</dt>
          <dd>
            {result.ranked.length}
            <small> ranked · {result.partial.length} partial</small>
          </dd>
        </div>
        <div className="segment-stats__card">
          <dt>Dream ride</dt>
          <dd>
            {formatSegmentTime(result.dream.total_seconds)}
            {topHolder && (
              <small>
                {" "}
                {topHolder.rider.display_name} holds {topHolder.segments} of{" "}
                {result.segments.length}
              </small>
            )}
          </dd>
        </div>
        <div className="segment-stats__card">
          <dt>Sum of Strava KOMs</dt>
          <dd>
            {result.kom_total_seconds
              ? formatSegmentTime(result.kom_total_seconds)
              : "—"}
            {result.kom_total_seconds && leader && (
              <small>
                {" "}
                leader at{" "}
                {Math.round(
                  (result.kom_total_seconds / leader.total_seconds) * 100,
                )}
                %
              </small>
            )}
          </dd>
        </div>
        <div className="segment-stats__card">
          <dt>1st to 2nd</dt>
          <dd>
            {leader && second
              ? second.total_seconds === leader.total_seconds
                ? "Tie"
                : formatSegmentTime(second.total_seconds - leader.total_seconds)
              : "—"}
          </dd>
        </div>
      </dl>
    </>
  );
}
