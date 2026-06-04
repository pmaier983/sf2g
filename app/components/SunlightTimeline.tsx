/**
 * SunlightTimeline — Horizontal bar showing dark → sunrise → daylight periods.
 *
 * Markers for departure time and estimated arrival at final waypoint.
 * Pure CSS/SVG implementation, no external library.
 */

interface SunlightTimelineProps {
  sunrise: string          // ISO datetime string
  sunset: string           // ISO datetime string
  departureTime: Date      // When the rider departs
  arrivalTime: Date        // When the rider arrives at the last waypoint
}

/**
 * Convert a Date to minutes since midnight (in local timezone).
 */
function toMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Format minutes since midnight as "h:mm AM/PM".
 */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`
}

export function SunlightTimeline({
  sunrise,
  sunset,
  departureTime,
  arrivalTime,
}: SunlightTimelineProps) {
  // Timeline window: 4 AM to 10 AM (typical commute range)
  const rangeStart = 4 * 60   // 4:00 AM
  const rangeEnd = 10 * 60    // 10:00 AM
  const rangeLen = rangeEnd - rangeStart

  const sunriseMin = sunrise ? toMinutes(new Date(sunrise)) : 6 * 60
  const sunsetMin = sunset ? toMinutes(new Date(sunset)) : 20 * 60
  const departMin = toMinutes(departureTime)
  const arriveMin = toMinutes(arrivalTime)

  // Calculate percentage positions (clamped to range)
  const pct = (min: number) =>
    Math.max(0, Math.min(100, ((min - rangeStart) / rangeLen) * 100))

  const sunrisePct = pct(sunriseMin)
  const departPct = pct(departMin)
  const arrivePct = pct(arriveMin)

  // Determine if departure is before sunrise
  const isDarkStart = departMin < sunriseMin

  return (
    <div className="sunlight-timeline">
      <h3 className="sunlight-timeline__title">🌅 Sunlight Timeline</h3>
      <div className="sunlight-timeline__bar-container">
        {/* Dark period */}
        <div
          className="sunlight-timeline__dark"
          style={{ width: `${sunrisePct}%` }}
        />

        {/* Dawn transition (small gradient) */}
        <div
          className="sunlight-timeline__dawn"
          style={{
            left: `${Math.max(0, sunrisePct - 3)}%`,
            width: '6%',
          }}
        />

        {/* Daylight period */}
        <div
          className="sunlight-timeline__light"
          style={{
            left: `${sunrisePct}%`,
            width: `${100 - sunrisePct}%`,
          }}
        />

        {/* Sunrise marker */}
        <div
          className="sunlight-timeline__marker sunlight-timeline__marker--sunrise"
          style={{ left: `${sunrisePct}%` }}
        >
          <span className="sunlight-timeline__marker-icon">🌅</span>
          <span className="sunlight-timeline__marker-label">
            {formatTime(sunriseMin)}
          </span>
        </div>

        {/* Departure marker */}
        <div
          className="sunlight-timeline__marker sunlight-timeline__marker--depart"
          style={{ left: `${departPct}%` }}
        >
          <span className="sunlight-timeline__marker-icon">🚴</span>
          <span className="sunlight-timeline__marker-label">
            Depart {formatTime(departMin)}
          </span>
        </div>

        {/* Arrival marker */}
        <div
          className="sunlight-timeline__marker sunlight-timeline__marker--arrive"
          style={{ left: `${arrivePct}%` }}
        >
          <span className="sunlight-timeline__marker-icon">🏁</span>
          <span className="sunlight-timeline__marker-label">
            Arrive {formatTime(arriveMin)}
          </span>
        </div>
      </div>

      {/* Time labels along the bottom */}
      <div className="sunlight-timeline__labels">
        {[4, 5, 6, 7, 8, 9, 10].map((h) => (
          <span key={h} className="sunlight-timeline__hour-label">
            {h === 0 ? '12' : h > 12 ? h - 12 : h}
            {h < 12 ? 'a' : 'p'}
          </span>
        ))}
      </div>

      {isDarkStart && (
        <p className="sunlight-timeline__note">
          ⚠️ You&apos;ll start in the dark — bring lights!
        </p>
      )}
    </div>
  )
}
