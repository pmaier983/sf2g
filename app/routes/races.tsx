import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  RACES_DATA_URL,
  RACES_SEARCH_DEFAULTS,
  parseRacesSearch,
  type RacesFile,
  type RacesSearch,
} from "../lib/races";
import { RacesPageContent } from "../components/races/RacesPageContent";
import { DEFAULT_ORIGIN, type Origin } from "../lib/race-travel";
import { useUnit } from "../lib/useUnit";
import "../styles/races.css";

/**
 * /races — the 2027 race calendar for Bay Area riders.
 *
 * The data is a static asset (public/data/races-2027.json, ~300 KB) fetched
 * and rendered entirely in the browser. The Worker only serves the page
 * shell, so the 10 ms CPU budget is never touched by the 65 events.
 */
export const Route = createFileRoute("/races")({
  validateSearch: (raw: Record<string, unknown>): RacesSearch =>
    parseRacesSearch(raw),
  search: {
    // Keep URLs short: drop defaults.
    middlewares: [stripSearchParams(RACES_SEARCH_DEFAULTS)],
  },
  component: RacesPage,
  head: () => ({
    meta: [
      { title: "2027 Bike Races – SF2G" },
      {
        name: "description",
        content:
          "Every California road race posted for 2027 plus US stage races, with one-lap course maps, elevation profiles, travel times from wherever you start and links to each source.",
      },
    ],
  }),
});

const ORIGIN_KEY = "sf2g-races-origin";

/** The viewer's last "From" choice; stays in this browser only. */
function readStoredOrigin(): Origin | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? "null");
    if (
      raw &&
      typeof raw.label === "string" &&
      Number.isFinite(raw.lat) &&
      Number.isFinite(raw.lng)
    ) {
      return {
        label: raw.label,
        lat: raw.lat,
        lng: raw.lng,
        exact: raw.label === DEFAULT_ORIGIN.label && raw.exact === true,
      };
    }
  } catch {
    /* private mode, bad JSON */
  }
  return null;
}

async function fetchRaces(): Promise<RacesFile> {
  const res = await fetch(RACES_DATA_URL);
  if (!res.ok) throw new Error(`races data: HTTP ${res.status}`);
  return (await res.json()) as RacesFile;
}

function RacesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const unit = useUnit();
  // SSR and first paint use SF; the stored choice loads after mount.
  const [origin, setOrigin] = useState<Origin>(DEFAULT_ORIGIN);
  useEffect(() => {
    const stored = readStoredOrigin();
    if (stored) setOrigin(stored);
  }, []);
  const onOriginChange = useCallback((next: Origin) => {
    setOrigin(next);
    try {
      localStorage.setItem(ORIGIN_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);
  const { data, error, isPending } = useQuery({
    queryKey: ["races-2027"],
    queryFn: fetchRaces,
    staleTime: Infinity,
  });

  // Deep links (#event-id) only resolve once the rows exist, and after the
  // router's own scroll-to-top on navigation.
  useEffect(() => {
    if (!data) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const timer = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ block: "start" });
    }, 100);
    return () => clearTimeout(timer);
  }, [data]);

  const onSearchChange = (next: Partial<RacesSearch>) => {
    navigate({
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
      resetScroll: false,
    });
  };

  return (
    <div className="races-page">
      <div className="container">
        <header className="races-page__header animate-fade-in">
          <h1 className="races-page__title">2027 Bike Races</h1>
          <p className="races-page__subtitle">
            Every California road race posted for 2027, plus multi-day stage
            races across the US. Each California course shows one lap: the route
            from a real race GPS file and its elevation profile. Every event
            lists where its date, route and elevation came from.
          </p>
        </header>

        {data ? (
          <RacesPageContent
            data={data}
            search={search}
            onSearchChange={onSearchChange}
            origin={origin}
            onOriginChange={onOriginChange}
            unit={unit}
          />
        ) : error ? (
          <p className="races-page__error" role="alert">
            Couldn&apos;t load the race calendar. {String(error.message)}
          </p>
        ) : isPending ? (
          <p className="races-page__loading" aria-busy="true">
            Loading the 2027 calendar…
          </p>
        ) : null}
      </div>
    </div>
  );
}
