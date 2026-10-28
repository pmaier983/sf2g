/**
 * GitHub-contribution-style season grid: one square per day of the year in
 * Sunday-first week columns, each holding the races run that day.
 * Pure date math in UTC so it never shifts with the viewer's time zone.
 */
import type { RaceEvent } from "./races";

export interface SeasonDay {
  iso: string;
  /** False for the padding days before Jan 1 and after Dec 31. */
  inYear: boolean;
  events: RaceEvent[];
}

export interface SeasonGrid {
  /** weeks[w][d], d = 0 is Sunday */
  weeks: SeasonDay[][];
  /** Month label and the week column that holds its 1st. */
  months: { label: string; week: number }[];
  /** Events that have no exact day (month-only, TBA). */
  undated: RaceEvent[];
  /** Most races on any single day, for the colour scale. */
  maxPerDay: number;
}

const DAY_MS = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Every ISO day an event runs: its listed series dates, else start..end. */
export function raceDays(e: RaceEvent): string[] {
  if (!e.start || e.dateStatus === "month") return [];
  if (e.dates && e.dates.length > 0) return [...e.dates];
  const out: string[] = [];
  const end = msOf(e.end ?? e.start);
  for (let t = msOf(e.start); t <= end; t += DAY_MS) out.push(isoOf(t));
  return out;
}

export function seasonGrid(year: number, events: RaceEvent[]): SeasonGrid {
  const byDay = new Map<string, RaceEvent[]>();
  const undated: RaceEvent[] = [];
  for (const e of events) {
    const days = raceDays(e);
    if (days.length === 0) {
      undated.push(e);
      continue;
    }
    for (const iso of days) {
      const list = byDay.get(iso) ?? [];
      list.push(e);
      byDay.set(iso, list);
    }
  }

  const jan1 = Date.UTC(year, 0, 1);
  const dec31 = Date.UTC(year, 11, 31);
  const first = jan1 - new Date(jan1).getUTCDay() * DAY_MS;
  const last = dec31 + (6 - new Date(dec31).getUTCDay()) * DAY_MS;

  const weeks: SeasonDay[][] = [];
  const months: SeasonGrid["months"] = [];
  let maxPerDay = 0;
  for (let t = first, i = 0; t <= last; t += DAY_MS, i++) {
    const iso = isoOf(t);
    const inYear = t >= jan1 && t <= dec31;
    const dayEvents = inYear ? (byDay.get(iso) ?? []) : [];
    maxPerDay = Math.max(maxPerDay, dayEvents.length);
    const w = Math.floor(i / 7);
    if (!weeks[w]) weeks[w] = [];
    weeks[w].push({ iso, inYear, events: dayEvents });
    const d = new Date(t);
    if (inYear && d.getUTCDate() === 1) {
      months.push({ label: MONTHS[d.getUTCMonth()], week: w });
    }
  }
  return { weeks, months, undated, maxPerDay };
}
