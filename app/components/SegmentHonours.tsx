/**
 * KOM recognition (phase 09, P4a; Phillip 2026-11-18: "if someone is the KOM
 * of the segment that's its own special recognition").
 *
 * ♛ gold crown: holds the current Strava KOM (all athletes, not just SF2G)
 * ♛ outline:    a former Strava KOM
 * ★ orange star: the fastest SF2G rider (SF2G record)
 */
import type { Honours } from "../lib/segment-cumulative";
import { formatSegmentTime } from "../lib/segment-format";

export function StravaKomCrown({
  komSeconds,
  checkedAt,
  former = false,
}: {
  komSeconds?: number | null;
  checkedAt?: string | null;
  former?: boolean;
}) {
  const checked = checkedAt ? ` (checked ${relativeDays(checkedAt)})` : "";
  const label = former
    ? "Former Strava KOM"
    : `Strava KOM${komSeconds ? `, ${formatSegmentTime(komSeconds)}` : ""}${checked}`;
  return (
    <span
      className={`honour honour--kom${former ? " honour--former" : ""}`}
      title={label}
      aria-label={label}
      role="img"
    >
      ♛
    </span>
  );
}

export function Sf2gRecordStar() {
  return (
    <span
      className="honour honour--record"
      title="SF2G record: fastest SF2G rider"
      aria-label="SF2G record"
      role="img"
    >
      ★
    </span>
  );
}

/** All honours of one time, Strava KOM first. */
export function HonourBadges({
  honours,
  komSeconds,
  checkedAt,
}: {
  honours: Honours | null;
  komSeconds?: number | null;
  checkedAt?: string | null;
}) {
  if (!honours) return null;
  return (
    <span className="honours">
      {honours.stravaKom && (
        <StravaKomCrown komSeconds={komSeconds} checkedAt={checkedAt} />
      )}
      {honours.formerKom && <StravaKomCrown former />}
      {honours.sf2gRecord && <Sf2gRecordStar />}
    </span>
  );
}

/** "♛ 2 ★ 5" next to a rider's name in the totals tables. */
export function HonourCounts({
  stravaKoms,
  records,
}: {
  stravaKoms: number;
  records: number;
}) {
  if (stravaKoms === 0 && records === 0) return null;
  return (
    <span className="honours honours--counts">
      {stravaKoms > 0 && (
        <span
          className="honour honour--kom"
          title={`Holds ${stravaKoms} Strava KOM${stravaKoms === 1 ? "" : "s"}`}
        >
          ♛ {stravaKoms}
        </span>
      )}
      {records > 0 && (
        <span
          className="honour honour--record"
          title={`${records} SF2G record${records === 1 ? "" : "s"}`}
        >
          ★ {records}
        </span>
      )}
    </span>
  );
}

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
