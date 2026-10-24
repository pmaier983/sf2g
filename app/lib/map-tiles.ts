/**
 * Map tile provider for every Leaflet map.
 *
 * CARTO basemaps started returning "API KEY REQUIRED" images (audit F5.3),
 * so the default is OpenStreetMap's standard tiles: free, no key, fine for
 * a low-traffic site that shows the attribution. Dark mode inverts them with
 * a CSS filter (.map-tiles--dark in components.css).
 *
 * To use a keyed provider instead (Stadia, MapTiler, CARTO with a key), set
 * at build time:
 *   VITE_MAP_TILE_URL, VITE_MAP_TILE_URL_DARK (optional), VITE_MAP_TILE_ATTRIBUTION
 * and add the provider's host to img-src in the CSP (app/routes/__root.tsx).
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const LIGHT_URL = env.VITE_MAP_TILE_URL || OSM_URL;
const DARK_URL = env.VITE_MAP_TILE_URL_DARK;
const ATTRIBUTION = env.VITE_MAP_TILE_ATTRIBUTION || OSM_ATTRIBUTION;

export type MapTheme = "light" | "dark" | string;

export function tileUrl(theme: MapTheme): string {
  return theme === "dark" && DARK_URL ? DARK_URL : LIGHT_URL;
}

/** Leaflet tileLayer options (without per-map extras like maxZoom). */
export function tileOptions(theme: MapTheme): {
  attribution: string;
  className?: string;
} {
  return {
    attribution: ATTRIBUTION,
    // No native dark tiles: darken the light ones in CSS.
    className: theme === "dark" && !DARK_URL ? "map-tiles--dark" : undefined,
  };
}
