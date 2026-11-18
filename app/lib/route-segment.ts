/**
 * What the route view (map + elevation profile + lanes) needs to know about
 * a segment. Built from the segment matrix (phase 09) by the page.
 */
export interface RouteSegment {
  id: number;
  name: string;
  distance_meters: number;
  average_grade: number;
  terrain: "climb" | "flat";
  start_latlng: [number, number];
  end_latlng: [number, number];
  kom_seconds: number | null;
  /** Fastest SF2G rider for the period shown, if any. */
  leader: { display_name: string; best_seconds: number } | null;
}
