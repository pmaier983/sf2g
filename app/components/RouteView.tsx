/**
 * The /segments route view (phase 07c, picker since 09d): map of the
 * corridor route over its elevation profile, with every selectable segment
 * drawn on both. Segments in the current selection are filled; clicking a
 * bar or a map line toggles it.
 *
 * Lazy-loaded by the page (Leaflet + the corridor's profile JSON are their
 * own chunks). Uses the page's segment matrix — no request of its own.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SegmentCorridor } from "../lib/constants";
import { loadCorridorProfile } from "../lib/corridor-profile";
import { placeSegments } from "../lib/segment-lanes";
import { useUnit } from "../lib/useUnit";
import type { RouteSegment } from "../lib/route-segment";
import { ElevationProfile } from "./ElevationProfile";
import { RouteMap } from "./RouteMap";
import { RouteViewSkeleton } from "./RouteViewSkeleton";

export interface RouteViewProps {
  corridor: SegmentCorridor;
  segments: RouteSegment[];
  /** Ids in the current selection; bars outside it are outlined. */
  included?: ReadonlySet<number>;
  hoveredId: number | null;
  selectedId: number | null;
  onHover: (id: number | null) => void;
  /** A segment was picked on the map or the profile. */
  onSelect: (id: number) => void;
}

export default function RouteView({
  corridor,
  segments,
  included,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: RouteViewProps) {
  const unit = useUnit();
  const [markerAt, setMarkerAt] = useState<number | null>(null);
  const { data: profile, error } = useQuery({
    queryKey: ["corridor-profile", corridor],
    queryFn: () => loadCorridorProfile(corridor),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const bars = useMemo(
    () => (profile ? placeSegments(segments, profile) : []),
    [profile, segments],
  );
  const byId = useMemo(
    () => new Map(segments.map((s) => [s.id, s])),
    [segments],
  );
  const terrain = useMemo(
    () => new Map(segments.map((s) => [s.id, s.terrain])),
    [segments],
  );

  if (error)
    return (
      <p className="route-view__error" role="alert">
        Couldn't load the route.
      </p>
    );
  if (!profile) return <RouteViewSkeleton />;

  return (
    <div className="route-view">
      <RouteMap
        profile={profile}
        bars={bars}
        terrain={terrain}
        included={included}
        hoveredId={hoveredId}
        selectedId={selectedId}
        markerAt={markerAt}
        onHover={onHover}
        onSelect={onSelect}
      />
      <ElevationProfile
        profile={profile}
        bars={bars}
        segments={byId}
        unit={unit}
        hoveredId={hoveredId}
        selectedId={selectedId}
        onHover={onHover}
        onSelect={onSelect}
        onHoverDistance={setMarkerAt}
        included={included}
      />
    </div>
  );
}
