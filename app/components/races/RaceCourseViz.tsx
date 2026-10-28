import {
  courseCaption,
  mapGeometry,
  profileGeometry,
  type DistanceUnit,
  type RaceCourse,
} from "../../lib/races";
import { climbingPerMile, formatClimbingRate } from "../../lib/race-terrain";

/**
 * One lap of a course: a small route map (SVG of the projected path with a
 * dot at the start) beside an elevation profile (SVG area chart), captioned
 * with the lap's distance, climbing and elevation range.
 */
export function RaceCourseViz({
  course,
  unit = "mi",
}: {
  course: RaceCourse;
  unit?: DistanceUnit;
}) {
  const map = mapGeometry(course.path);
  const prof = profileGeometry(course);
  return (
    <div className="race-viz">
      <svg
        className="race-viz__map"
        viewBox={`0 0 ${map.size} ${map.size}`}
        role="img"
        aria-label="Course map, one lap"
      >
        <path
          d={map.d}
          fill="none"
          stroke="var(--color-sf2g-orange)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={map.start.x.toFixed(1)}
          cy={map.start.y.toFixed(1)}
          r="2.6"
          fill="var(--color-text)"
        />
      </svg>
      <div className="race-viz__profile-wrap">
        <svg
          className="race-viz__profile"
          viewBox={`0 0 ${prof.width} ${prof.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Elevation profile, one lap"
        >
          <path d={prof.area} fill="var(--color-sf2g-orange)" opacity="0.18" />
          <path
            d={prof.line}
            fill="none"
            stroke="var(--color-sf2g-orange)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="race-viz__caption">{courseCaption(course, unit)}</div>
        <div className="race-viz__rate">
          {formatClimbingRate(climbingPerMile(course), unit)} of climbing
        </div>
      </div>
    </div>
  );
}
