/**
 * GroupRideMap — animated Leaflet map that replays a group ride.
 *
 * Draws each rider's route as a colored polyline and renders animated
 * circular markers (with avatar or fallback gradient + initials) that
 * move along the route based on `currentTime`.
 *
 * Uses Leaflet with CartoDB tiles (free, no API key needed).
 * Follows InteractiveMap.tsx patterns exactly:
 *  - CSS injected first, then a `mounted` guard prevents rendering
 *    any map container until CSS is present in <head>
 *  - Leaflet attached directly to containerRef (no intermediate child)
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type L from "leaflet";
import type { GroupRideDetailRider } from "../server/group-rides";
import { RIDER_COLORS } from "../lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupRideMapProps {
  riders: GroupRideDetailRider[];
  currentTime: number; // seconds from earliest start
  isPlaying: boolean;
  trimStartSec: number;
  trimEndSec: number;
  rawDuration: number;
}

/** Rider with valid stream data, pre-computed for rendering */
interface PreparedRider {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  latlng: [number, number][];
  time: number[];
  /** Offset in seconds from earliest start_date */
  offset: number;
  /** Total duration of the rider's stream */
  duration: number;
  color: string;
  index: number;
}

// ---------------------------------------------------------------------------
// Tile layer URLs (CartoDB — dark/light variants)
// ---------------------------------------------------------------------------

const TILE_LIGHT =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_DARK =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useLeaflet() {
  const [leaflet, setLeaflet] = useState<typeof L | null>(null);
  useEffect(() => {
    import("leaflet").then((mod) => setLeaflet(mod.default));
  }, []);
  return leaflet;
}

function useTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const html = document.documentElement;
    setTheme(html.getAttribute("data-theme") === "dark" ? "dark" : "light");
    const observer = new MutationObserver(() => {
      setTheme(html.getAttribute("data-theme") === "dark" ? "dark" : "light");
    });
    observer.observe(html, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEarliestStartEpoch(riders: GroupRideDetailRider[]): number {
  let earliest = Infinity;
  for (const rider of riders) {
    const epoch = new Date(rider.ride.start_date).getTime() / 1000;
    if (epoch < earliest) earliest = epoch;
  }
  return earliest;
}

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function interpolatePosition(
  riderTime: number,
  timeStream: number[],
  latlngStream: [number, number][],
): [number, number] | null {
  if (timeStream.length === 0 || latlngStream.length === 0) return null;
  if (
    riderTime < timeStream[0] ||
    riderTime > timeStream[timeStream.length - 1]
  )
    return null;

  let lo = 0;
  let hi = timeStream.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (timeStream[mid] <= riderTime) lo = mid;
    else hi = mid;
  }

  if (lo === hi || timeStream[lo] === timeStream[hi]) return latlngStream[lo];

  const t = (riderTime - timeStream[lo]) / (timeStream[hi] - timeStream[lo]);
  const lat =
    latlngStream[lo][0] + t * (latlngStream[hi][0] - latlngStream[lo][0]);
  const lng =
    latlngStream[lo][1] + t * (latlngStream[hi][1] - latlngStream[lo][1]);
  return [lat, lng];
}

function createRiderIcon(LLib: typeof L, rider: PreparedRider): L.DivIcon {
  const size = 32;
  let innerHtml: string;

  if (rider.avatarUrl) {
    const safeUrl = rider.avatarUrl.startsWith("https://")
      ? rider.avatarUrl
      : "";
    innerHtml = `<div class="group-ride-map__marker" style="border-color: ${rider.color};">
      <img src="${safeUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" />
    </div>`;
  } else {
    const initials = getInitials(rider.displayName);
    const safeInitials = initials.replace(/[<>&"']/g, "");
    innerHtml = `<div class="group-ride-map__marker group-ride-map__marker--fallback" style="border-color: ${rider.color}; background: linear-gradient(135deg, ${rider.color}, ${rider.color}88);">
      <span style="color:#fff;font-size:11px;font-weight:700;font-family:Inter,sans-serif;line-height:1;">${safeInitials}</span>
    </div>`;
  }

  return LLib.divIcon({
    className: "group-ride-map__marker-wrapper",
    html: innerHtml,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ---------------------------------------------------------------------------
// Inner map component — only rendered after CSS + mount guard
// ---------------------------------------------------------------------------

interface MapInnerProps extends GroupRideMapProps {
  LLib: typeof L;
  theme: "dark" | "light";
  preparedRiders: PreparedRider[];
  trimmedRiders: (PreparedRider & { trimmedLatlng: [number, number][] })[];
}

function MapInner({
  LLib,
  theme,
  preparedRiders,
  trimmedRiders,
  currentTime,
  isPlaying,
}: MapInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const polylinesRef = useRef<L.Polyline[]>([]);
  const prevIsPlayingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Initialize map once — same pattern as InteractiveMap
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = LLib.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([37.6, -122.4], 10);

    LLib.tileLayer(theme === "dark" ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;

    // Invalidate size after layout settles
    setTimeout(() => map.invalidateSize(), 0);
    setTimeout(() => map.invalidateSize(), 200);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      for (const marker of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      for (const poly of polylinesRef.current) poly.remove();
      polylinesRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Update tile layer on theme change
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.eachLayer((layer) => {
      if ((layer as any)._url?.includes("cartocdn")) {
        mapRef.current!.removeLayer(layer);
      }
    });
    LLib.tileLayer(theme === "dark" ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(mapRef.current);
  }, [theme, LLib]);

  // -------------------------------------------------------------------------
  // Draw polylines when trimmedRiders changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old polylines
    for (const poly of polylinesRef.current) poly.remove();
    polylinesRef.current = [];

    const allCoords: [number, number][] = [];
    for (const rider of trimmedRiders) {
      if (rider.trimmedLatlng.length === 0) continue;
      const poly = LLib.polyline(rider.trimmedLatlng, {
        color: rider.color,
        weight: 3,
        opacity: 0.8,
        smoothFactor: 1,
      }).addTo(map);
      polylinesRef.current.push(poly);
      for (const coord of rider.trimmedLatlng) allCoords.push(coord);
    }

    if (allCoords.length > 0) {
      map.fitBounds(LLib.latLngBounds(allCoords).pad(0.1));
    }
  }, [LLib, trimmedRiders]);

  // -------------------------------------------------------------------------
  // Update marker positions
  // -------------------------------------------------------------------------

  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const activePositions: [number, number][] = [];

    for (const rider of preparedRiders) {
      const riderTime = currentTime - rider.offset;
      const position = interpolatePosition(riderTime, rider.time, rider.latlng);
      const existingMarker = markersRef.current.get(rider.userId);

      if (position) {
        activePositions.push(position);
        if (!existingMarker) {
          const icon = createRiderIcon(LLib, rider);
          const marker = LLib.marker([position[0], position[1]], {
            icon,
          }).addTo(map);
          markersRef.current.set(rider.userId, marker);
        } else {
          existingMarker.setLatLng([position[0], position[1]]);
          existingMarker.setOpacity(1);
        }
      } else if (existingMarker) {
        existingMarker.setOpacity(0);
      }
    }

    if (isPlaying && activePositions.length > 0) {
      const bounds = LLib.latLngBounds(activePositions);
      const mapBounds = map.getBounds();
      const needsRefit = activePositions.some(([lat, lng]) => {
        const padding = 0.15;
        const latRange = mapBounds.getNorth() - mapBounds.getSouth();
        const lngRange = mapBounds.getEast() - mapBounds.getWest();
        return (
          lat < mapBounds.getSouth() + latRange * padding ||
          lat > mapBounds.getNorth() - latRange * padding ||
          lng < mapBounds.getWest() + lngRange * padding ||
          lng > mapBounds.getEast() - lngRange * padding
        );
      });
      if (needsRefit) {
        map.fitBounds(bounds.pad(0.5), {
          maxZoom: 13,
          animate: true,
          duration: 0.5,
        });
      }
    }
  }, [LLib, preparedRiders, currentTime, isPlaying]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  // -------------------------------------------------------------------------
  // Fit bounds when playback starts
  // -------------------------------------------------------------------------

  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    prevIsPlayingRef.current = isPlaying;

    if (
      !wasPlaying &&
      isPlaying &&
      mapRef.current &&
      preparedRiders.length > 0
    ) {
      const positions: [number, number][] = [];
      for (const rider of preparedRiders) {
        const pos = interpolatePosition(
          currentTime - rider.offset,
          rider.time,
          rider.latlng,
        );
        if (pos) positions.push(pos);
      }
      if (positions.length === 0) {
        for (const rider of preparedRiders) positions.push(rider.latlng[0]);
      }
      if (positions.length > 0) {
        mapRef.current.fitBounds(LLib.latLngBounds(positions).pad(0.5), {
          maxZoom: 12,
          animate: true,
          duration: 0.5,
        });
      }
    }
  }, [isPlaying, LLib, preparedRiders, currentTime]);

  return <div ref={containerRef} className="group-ride-map__canvas" />;
}

// ---------------------------------------------------------------------------
// Public component — CSS-first mount guard (matches InteractiveMap pattern)
// ---------------------------------------------------------------------------

export function GroupRideMap({
  riders,
  currentTime,
  isPlaying,
  trimStartSec,
  trimEndSec,
  rawDuration,
}: GroupRideMapProps) {
  const [mounted, setMounted] = useState(false);
  const LLib = useLeaflet();
  const theme = useTheme();

  // Inject Leaflet CSS first, then set mounted=true
  // The map container doesn't render until mounted=true, ensuring
  // CSS is in <head> before Leaflet measures any dimensions.
  useEffect(() => {
    const existingLink = document.querySelector('link[href*="leaflet"]');
    if (existingLink) {
      setMounted(true);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    link.crossOrigin = "";
    document.head.appendChild(link);
    setMounted(true);
    return () => {
      if (link.parentNode) document.head.removeChild(link);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Prepare rider data (stable — only changes when riders prop changes)
  // -------------------------------------------------------------------------

  const preparedRiders = useMemo((): PreparedRider[] => {
    const earliestEpoch = getEarliestStartEpoch(riders);
    const result: PreparedRider[] = [];
    let colorIdx = 0;
    for (const rider of riders) {
      if (
        !rider.streams ||
        rider.streams.latlng.length === 0 ||
        rider.streams.time.length === 0
      )
        continue;

      const riderEpoch = new Date(rider.ride.start_date).getTime() / 1000;
      const offset = riderEpoch - earliestEpoch;
      const timeStream = rider.streams.time;
      const duration = timeStream[timeStream.length - 1] - timeStream[0];

      result.push({
        userId: rider.userId,
        displayName: rider.displayName,
        avatarUrl: rider.avatarUrl,
        latlng: rider.streams.latlng,
        time: timeStream,
        offset,
        duration,
        color: RIDER_COLORS[colorIdx % RIDER_COLORS.length],
        index: colorIdx,
      });
      colorIdx++;
    }
    return result;
  }, [riders]);

  const trimmedRiders = useMemo(() => {
    const globalTrimStart = trimStartSec;
    const globalTrimEnd = rawDuration - trimEndSec;

    return preparedRiders.map((rider) => {
      if (trimStartSec === 0 && trimEndSec === 0) {
        return { ...rider, trimmedLatlng: rider.latlng };
      }
      const riderTrimStart = Math.max(0, globalTrimStart - rider.offset);
      const riderTrimEnd = Math.min(
        rider.duration,
        globalTrimEnd - rider.offset,
      );

      if (riderTrimStart >= riderTrimEnd) {
        return { ...rider, trimmedLatlng: [] as [number, number][] };
      }

      let startIdx = 0;
      for (let i = 0; i < rider.time.length; i++) {
        if (rider.time[i] >= riderTrimStart) {
          startIdx = i;
          break;
        }
      }
      let endIdx = rider.time.length - 1;
      for (let i = rider.time.length - 1; i >= 0; i--) {
        if (rider.time[i] <= riderTrimEnd) {
          endIdx = i;
          break;
        }
      }
      return {
        ...rider,
        trimmedLatlng: rider.latlng.slice(startIdx, endIdx + 1),
      };
    });
  }, [preparedRiders, trimStartSec, trimEndSec, rawDuration]);

  if (preparedRiders.length === 0) {
    return (
      <div className="group-ride-map group-ride-map--empty">
        <p className="group-ride-map__empty-text">
          No GPS data available for this group ride.
        </p>
      </div>
    );
  }

  return (
    <div className="group-ride-map">
      {mounted && LLib ? (
        <MapInner
          riders={riders}
          LLib={LLib}
          theme={theme}
          preparedRiders={preparedRiders}
          trimmedRiders={trimmedRiders}
          currentTime={currentTime}
          isPlaying={isPlaying}
          trimStartSec={trimStartSec}
          trimEndSec={trimEndSec}
          rawDuration={rawDuration}
        />
      ) : (
        <div className="group-ride-map__canvas group-ride-map__canvas--loading" />
      )}
      <div className="group-ride-map__legend">
        {preparedRiders.map((rider) => (
          <div key={rider.userId} className="group-ride-map__legend-item">
            <span
              className="group-ride-map__legend-dot"
              style={{ background: rider.color }}
            />
            <span className="group-ride-map__legend-name">
              {rider.displayName}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
