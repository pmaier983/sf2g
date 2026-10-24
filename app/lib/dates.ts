/**
 * Calendar dates for SF2G, always in America/Los_Angeles.
 *
 * Rides, presets ("Today", "This Week") and forecast days are LA calendar
 * dates. Computing them with the machine's zone made the server (UTC) and a
 * browser (anywhere) disagree, which broke hydration on /should-i-sf2g and
 * shifted "Today" by a day in the evening. Every helper here takes an
 * explicit `now` so server and client can agree and tests are deterministic.
 * Dates are YYYY-MM-DD strings; arithmetic is done at UTC noon so DST never
 * moves a date.
 */

export const SF2G_TIME_ZONE = "America/Los_Angeles";

/** YYYY-MM-DD of `now` in `timeZone`. */
export function localDate(now: Date, timeZone = SF2G_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Today's date in LA. */
export function todayInLA(now: Date = new Date()): string {
  return localDate(now);
}

/** Short weekday name ("Mon") for a YYYY-MM-DD date. */
export function weekdayShort(iso: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(`${iso}T12:00:00Z`).getUTCDay()
  ];
}

/** Calendar year in LA. */
export function yearInLA(now: Date = new Date()): number {
  return Number(localDate(now).slice(0, 4));
}

const LA_HOUR_MINUTE = new Intl.DateTimeFormat("en-US", {
  timeZone: SF2G_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since midnight in LA for an ISO timestamp (ride start times). */
export function minutesOfDayInLA(isoTimestamp: string): number {
  const parts = LA_HOUR_MINUTE.formatToParts(new Date(isoTimestamp));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return get("hour") * 60 + get("minute");
}
