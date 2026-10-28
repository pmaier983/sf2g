import { useEffect, useId, useState } from "react";
import {
  ORIGIN_PRESETS,
  TRAVEL_MODES,
  TRAVEL_MODE_ORDER,
  DEFAULT_ORIGIN,
  findOrigin,
  greatCircleMi,
  type Origin,
  type TravelMode,
} from "../../lib/race-travel";
import { formatDistance, type DistanceUnit } from "../../lib/races";

export interface RaceOriginPickerProps {
  origin: Origin;
  onOriginChange: (origin: Origin) => void;
  /** How many of the listed races fall in each travel mode. */
  modeCounts: Record<TravelMode, number>;
  unit: DistanceUnit;
}

/**
 * "From [San Francisco]" — a preset place (datalist), typed "lat, lng", or
 * the browser's location. Location never leaves the browser: no geocoding
 * request, nothing in the URL.
 */
export function RaceOriginPicker({
  origin,
  onOriginChange,
  modeCounts,
  unit,
}: RaceOriginPickerProps) {
  const dist = (mi: number) => {
    const d = formatDistance(mi, unit);
    return `${d.value} ${d.unit}`;
  };
  const speed = (mph: number) =>
    unit === "km" ? `${Math.round(mph * 1.609344)} km/h` : `${mph} mph`;
  // The bike caveat only matters around the Bay.
  const nearSF = greatCircleMi(origin, DEFAULT_ORIGIN) < 60;
  const listId = useId();
  const inputId = useId();
  const [draft, setDraft] = useState(origin.label);
  const [hint, setHint] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // Keep the box in sync when the origin changes from outside (stored
  // preference loaded after mount, "Use my location").
  useEffect(() => {
    setDraft(origin.label);
  }, [origin.label]);

  const commit = (text: string) => {
    const found = findOrigin(text);
    if (found) {
      setHint(null);
      if (found.label !== origin.label) onOriginChange(found);
    } else if (text.trim()) {
      setHint(
        "Pick a place from the list, type “lat, lng”, or use your location.",
      );
    }
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setHint("This browser can't share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setHint(null);
        onOriginChange({
          label: "My location",
          // ~100 m is plenty for a drive estimate
          lat: Math.round(pos.coords.latitude * 1000) / 1000,
          lng: Math.round(pos.coords.longitude * 1000) / 1000,
          exact: false,
        });
      },
      () => {
        setLocating(false);
        setHint("Couldn't get your location. Pick a place instead.");
      },
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  return (
    <section className="race-origin" aria-label="Travel estimates">
      <div className="race-origin__row">
        <label className="race-origin__label" htmlFor={inputId}>
          From
        </label>
        <input
          id={inputId}
          className="race-origin__input"
          list={listId}
          value={draft}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            // Picking from the datalist fires change with the exact label.
            if (findOrigin(e.target.value)) commit(e.target.value);
          }}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
          }}
          onFocus={(e) => e.target.select()}
          aria-describedby={hint ? `${inputId}-hint` : undefined}
        />
        <datalist id={listId}>
          {ORIGIN_PRESETS.map((o) => (
            <option key={o.label} value={o.label} />
          ))}
        </datalist>
        <button
          type="button"
          className="btn btn--ghost btn--sm race-origin__locate"
          onClick={useMyLocation}
          disabled={locating}
        >
          📍 {locating ? "Locating…" : "Use my location"}
        </button>
      </div>
      {hint && (
        <p className="race-origin__hint" id={`${inputId}-hint`} role="status">
          {hint}
        </p>
      )}
      <ul className="race-origin__legend" aria-label="How to get there">
        {TRAVEL_MODE_ORDER.map((m) => (
          <li key={m} title={TRAVEL_MODES[m].rule}>
            <span aria-hidden="true">{TRAVEL_MODES[m].emoji}</span>{" "}
            {TRAVEL_MODES[m].label} <b>{modeCounts[m]}</b>
          </li>
        ))}
      </ul>
      <p className="race-origin__note">
        {origin.exact
          ? "Drive times from SF City Hall are routed with OSRM (free-flow traffic)."
          : `Rough estimates from ${origin.label}: straight-line distance × 1.2 for roads, ${speed(55)} driving.`}{" "}
        🚲 {dist(25)} or less at {speed(14)}
        {nearSF &&
          "; the Bay has no bike bridge into SF, so add BART or the ferry"}{" "}
        · 🚗 up to 4 h · 🌙 over 4 h, go the day before · ✈️ over {dist(600)},
        air time + 2.5 h of airports.
      </p>
    </section>
  );
}
