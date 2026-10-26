/**
 * Map of a corridor route with its segments drawn on it (phase 07c).
 *
 * Each segment is the slice of the route between its along-track start and
 * end (segments sit within 400 m of the line by definition), so no segment
 * geometry has to be fetched. Colours come from CSS classes, so the hovered /
 * selected segment follows the theme like the rest of the page.
 */
import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";
import { tileOptions, tileUrl } from "../lib/map-tiles";
import {
  pointAtDistance,
  sliceRoute,
  type CorridorProfile,
} from "../lib/corridor-profile";
import type { PlacedBar } from "../lib/segment-lanes";

export interface RouteMapProps {
  profile: CorridorProfile;
  bars: PlacedBar[];
  /** Terrain per segment id, for the line colour. */
  terrain: ReadonlyMap<number, string>;
  hoveredId: number | null;
  selectedId: number | null;
  /** Metres along the route to mark (pointer over the elevation profile). */
  markerAt: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
}

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
    const read = () =>
      setTheme(html.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(html, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const segmentClass = (
  id: number,
  terrain: string | undefined,
  hoveredId: number | null,
  selectedId: number | null,
) =>
  [
    "route-map__segment",
    `route-map__segment--${terrain ?? "climb"}`,
    id === selectedId ? "route-map__segment--selected" : "",
    id === hoveredId && id !== selectedId ? "route-map__segment--hovered" : "",
  ]
    .filter(Boolean)
    .join(" ");

export function RouteMap({
  profile,
  bars,
  terrain,
  hoveredId,
  selectedId,
  markerAt,
  onHover,
  onSelect,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const segmentsRef = useRef<Map<number, L.Polyline>>(new Map());
  const markerRef = useRef<L.CircleMarker | null>(null);
  // Handlers change every render; the Leaflet listeners read the latest.
  const handlersRef = useRef({ onHover, onSelect });
  handlersRef.current = { onHover, onSelect };
  const LLib = useLeaflet();
  const theme = useTheme();

  // Map + route line, once.
  useEffect(() => {
    if (!LLib || !containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    const map = LLib.map(container, {
      scrollWheelZoom: false,
      zoomControl: true,
      // Fractional zoom: the route fits snugly instead of a whole level out.
      zoomSnap: 0.25,
      zoomDelta: 0.5,
    });
    // Wheel zoom only after the rider clicks into the map (no scroll traps).
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());

    LLib.polyline(profile.latlng, {
      className: "route-map__route",
      interactive: false,
    }).addTo(map);
    mapRef.current = map;

    // Fit the route once the (lazily mounted) container has its size, and
    // keep fitting on resize until the rider pans or zooms.
    const bounds = LLib.latLngBounds(profile.latlng);
    let userMoved = false;
    map.on("dragstart zoomstart", (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) userMoved = true;
    });
    map.on("click", () => (userMoved = true));
    const fit = () => {
      map.invalidateSize();
      if (!userMoved && container.clientWidth > 0 && container.clientHeight > 0)
        map.fitBounds(bounds, { padding: [16, 16], animate: false });
    };
    map.setView(bounds.getCenter(), 10);
    fit();
    const timer = setTimeout(fit, 50);

    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      segmentsRef.current.clear();
      markerRef.current = null;
    };
  }, [LLib, profile]);

  // Tiles follow the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!LLib || !map) return;
    tilesRef.current?.remove();
    tilesRef.current = LLib.tileLayer(tileUrl(theme), {
      ...tileOptions(theme),
      maxZoom: 18,
    }).addTo(map);
  }, [LLib, theme]);

  // One polyline per shown segment; redrawn when the set of segments changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!LLib || !map) return;
    for (const line of segmentsRef.current.values()) line.remove();
    segmentsRef.current.clear();
    for (const b of bars) {
      const line = LLib.polyline(sliceRoute(profile, b.startM, b.endM), {
        className: segmentClass(b.id, terrain.get(b.id), null, null),
      }).addTo(map);
      line.on("mouseover", () => handlersRef.current.onHover(b.id));
      line.on("mouseout", () => handlersRef.current.onHover(null));
      line.on("click", (e) => {
        LLib.DomEvent.stopPropagation(e);
        handlersRef.current.onSelect(b.id);
      });
      segmentsRef.current.set(b.id, line);
    }
  }, [LLib, profile, bars, terrain]);

  // Highlight state without redrawing.
  useEffect(() => {
    for (const [id, line] of segmentsRef.current) {
      const el = line.getElement();
      if (el)
        el.setAttribute(
          "class",
          `leaflet-interactive ${segmentClass(id, terrain.get(id), hoveredId, selectedId)}`,
        );
      if (id === hoveredId || id === selectedId) line.bringToFront();
    }
  }, [hoveredId, selectedId, terrain, bars, LLib]);

  // Marker for the point under the pointer on the elevation profile.
  useEffect(() => {
    const map = mapRef.current;
    if (!LLib || !map) return;
    if (markerAt === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const at = pointAtDistance(profile, markerAt).latlng;
    if (!markerRef.current) {
      markerRef.current = LLib.circleMarker(at, {
        radius: 6,
        className: "route-map__marker",
        interactive: false,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(at);
    }
  }, [LLib, profile, markerAt]);

  return (
    <div
      ref={containerRef}
      className="route-map"
      role="region"
      aria-label="Map of the route with its segments"
    />
  );
}
