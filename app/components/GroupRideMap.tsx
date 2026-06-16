/**
 * GroupRideMap — animated Leaflet map that replays a group ride.
 *
 * Draws each rider's route as a colored polyline and renders animated
 * circular markers that move along the route based on `currentTime`.
 *
 * Uses Leaflet with CartoDB tiles (free, no API key needed).
 */

// Static CSS import — Vite bundles this, no runtime injection needed
import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type L from "leaflet";
import type { GroupRideDetailRider } from "../server/group-rides";
import { RIDER_COLORS } from "../lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupRideMapProps {
  riders: GroupRideDetailRider[];
  currentTime: number;
  isPlaying: boolean;
  trimStartSec: number;
  trimEndSec: number;
  rawDuration: number;
}

interface PreparedRider {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  latlng: [number, number][];
  time: number[];
  offset: number;
  duration: number;
  color: string;
  index: number;
}

// ---------------------------------------------------------------------------
// Tile layer URLs
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
  if (parts.length >= 2)
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  return [
    latlngStream[lo][0] + t * (latlngStream[hi][0] - latlngStream[lo][0]),
    latlngStream[lo][1] + t * (latlngStream[hi][1] - latlngStream[lo][1]),
  ];
}

function createRiderIcon(LLib: typeof L, rider: PreparedRider): L.DivIcon {
  const size = 32;
  let innerHtml: string;
  if (rider.avatarUrl) {
    const safeUrl = rider.avatarUrl.startsWith("https://")
      ? rider.avatarUrl
      : "";
    innerHtml = `<div class="group-ride-map__marker" style="border-color:${rider.color}"><img src="${safeUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/></div>`;
  } else {
    const safeInitials = getInitials(rider.displayName).replace(/[<>&"']/g, "");
    innerHtml = `<div class="group-ride-map__marker group-ride-map__marker--fallback" style="border-color:${rider.color};background:linear-gradient(135deg,${rider.color},${rider.color}88)"><span style="color:#fff;font-size:11px;font-weight:700;font-family:Inter,sans-serif;line-height:1">${safeInitials}</span></div>`;
  }
  return LLib.divIcon({
    className: "group-ride-map__marker-wrapper",
    html: innerHtml,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupRideMap({
  riders,
  currentTime,
  isPlaying,
  trimStartSec,
  trimEndSec,
  rawDuration,
}: GroupRideMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const polylinesRef = useRef<L.Polyline[]>([]);
  const prevIsPlayingRef = useRef(false);
  const LLib = useLeaflet();
  const theme = useTheme();

  // -------------------------------------------------------------------------
  // Prepare rider data
  // -------------------------------------------------------------------------

  const preparedRiders = useMemo((): PreparedRider[] => {
    const earliestEpoch = getEarliestStartEpoch(riders);
    const result: PreparedRider[] = [];
    let colorIdx = 0;
    for (const rider of riders) {
      if (!rider.streams?.latlng?.length || !rider.streams?.time?.length)
        continue;
      const riderEpoch = new Date(rider.ride.start_date).getTime() / 1000;
      const offset = riderEpoch - earliestEpoch;
      const timeStream = rider.streams.time;
      result.push({
        userId: rider.userId,
        displayName: rider.displayName,
        avatarUrl: rider.avatarUrl,
        latlng: rider.streams.latlng,
        time: timeStream,
        offset,
        duration: timeStream[timeStream.length - 1] - timeStream[0],
        color: RIDER_COLORS[colorIdx % RIDER_COLORS.length],
        index: colorIdx++,
      });
    }
    return result;
  }, [riders]);

  const trimmedRiders = useMemo(() => {
    const globalTrimStart = trimStartSec;
    const globalTrimEnd = rawDuration - trimEndSec;
    return preparedRiders.map((rider) => {
      if (trimStartSec === 0 && trimEndSec === 0)
        return { ...rider, trimmedLatlng: rider.latlng };
      const rStart = Math.max(0, globalTrimStart - rider.offset);
      const rEnd = Math.min(rider.duration, globalTrimEnd - rider.offset);
      if (rStart >= rEnd)
        return { ...rider, trimmedLatlng: [] as [number, number][] };
      let si = 0;
      for (let i = 0; i < rider.time.length; i++) {
        if (rider.time[i] >= rStart) {
          si = i;
          break;
        }
      }
      let ei = rider.time.length - 1;
      for (let i = rider.time.length - 1; i >= 0; i--) {
        if (rider.time[i] <= rEnd) {
          ei = i;
          break;
        }
      }
      return { ...rider, trimmedLatlng: rider.latlng.slice(si, ei + 1) };
    });
  }, [preparedRiders, trimStartSec, trimEndSec, rawDuration]);

  // -------------------------------------------------------------------------
  // Initialize map once when LLib becomes available
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!LLib || !containerRef.current || mapRef.current) return;

    const container = containerRef.current;

    const map = LLib.map(container, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([37.6, -122.4], 10);

    LLib.tileLayer(theme === "dark" ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;

    // Let the browser finish layout before invalidating
    setTimeout(() => map.invalidateSize(), 50);
    setTimeout(() => map.invalidateSize(), 300);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);

    return () => {
      ro.disconnect();
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();
      for (const p of polylinesRef.current) p.remove();
      polylinesRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [LLib]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Update tile layer on theme change
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!mapRef.current || !LLib) return;
    mapRef.current.eachLayer((layer) => {
      if ((layer as any)._url?.includes("cartocdn"))
        mapRef.current!.removeLayer(layer);
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
    if (!map || !LLib) return;

    for (const p of polylinesRef.current) p.remove();
    polylinesRef.current = [];

    const allCoords: [number, number][] = [];
    for (const rider of trimmedRiders) {
      if (!rider.trimmedLatlng.length) continue;
      const poly = LLib.polyline(rider.trimmedLatlng, {
        color: rider.color,
        weight: 3,
        opacity: 0.8,
        smoothFactor: 1,
      }).addTo(map);
      polylinesRef.current.push(poly);
      allCoords.push(...rider.trimmedLatlng);
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
    if (!map || !LLib) return;

    const activePositions: [number, number][] = [];
    for (const rider of preparedRiders) {
      const position = interpolatePosition(
        currentTime - rider.offset,
        rider.time,
        rider.latlng,
      );
      const existing = markersRef.current.get(rider.userId);
      if (position) {
        activePositions.push(position);
        if (!existing) {
          const marker = LLib.marker(position, {
            icon: createRiderIcon(LLib, rider),
          }).addTo(map);
          markersRef.current.set(rider.userId, marker);
        } else {
          existing.setLatLng(position);
          existing.setOpacity(1);
        }
      } else if (existing) {
        existing.setOpacity(0);
      }
    }

    if (isPlaying && activePositions.length > 0) {
      const mb = map.getBounds();
      const needsRefit = activePositions.some(([lat, lng]) => {
        const latPad = (mb.getNorth() - mb.getSouth()) * 0.15;
        const lngPad = (mb.getEast() - mb.getWest()) * 0.15;
        return (
          lat < mb.getSouth() + latPad ||
          lat > mb.getNorth() - latPad ||
          lng < mb.getWest() + lngPad ||
          lng > mb.getEast() - lngPad
        );
      });
      if (needsRefit) {
        map.fitBounds(LLib.latLngBounds(activePositions).pad(0.5), {
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
  // Fit bounds on playback start
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
      if (!positions.length) {
        for (const rider of preparedRiders) positions.push(rider.latlng[0]);
      }
      if (positions.length > 0) {
        mapRef.current.fitBounds(LLib!.latLngBounds(positions).pad(0.5), {
          maxZoom: 12,
          animate: true,
          duration: 0.5,
        });
      }
    }
  }, [isPlaying, LLib, preparedRiders, currentTime]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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
      <div ref={containerRef} className="group-ride-map__canvas" />
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
