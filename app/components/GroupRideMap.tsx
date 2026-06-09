/**
 * GroupRideMap — animated Mapbox GL JS map that replays a group ride.
 *
 * Draws each rider's route as a colored polyline and renders animated
 * circular markers (with avatar or fallback gradient + initials) that
 * move along the route based on `currentTime`.
 *
 * Uses dynamic import of `mapbox-gl` for SSR safety, following the same
 * pattern as InteractiveMap.tsx's Leaflet usage.
 *
 * NOTE: Requires `mapbox-gl` to be installed:
 *   pnpm add mapbox-gl
 * And the env var VITE_MAPBOX_TOKEN set in .env.local.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { GroupRideDetailRider } from '../server/group-rides'
import { RIDER_COLORS } from '../lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupRideMapProps {
  riders: GroupRideDetailRider[]
  currentTime: number // seconds from earliest start
  isPlaying: boolean
}

/** Rider with valid stream data, pre-computed for rendering */
interface PreparedRider {
  userId: string
  displayName: string
  avatarUrl: string | null
  latlng: [number, number][]
  time: number[]
  /** Offset in seconds from earliest start_date */
  offset: number
  /** Total duration of the rider's stream */
  duration: number
  color: string
  index: number
}

// ---------------------------------------------------------------------------
// Mapbox GL dynamic import (SSR-safe, same pattern as InteractiveMap)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapboxGLModule = any

function useMapboxGL() {
  const [mapboxgl, setMapboxgl] = useState<MapboxGLModule | null>(null)

  useEffect(() => {
    // Dynamic import avoids SSR window reference issues
    import('mapbox-gl' as string).then((mod: MapboxGLModule) => {
      // Handle both ESM default and CJS module shapes
      setMapboxgl(mod.default ?? mod)
    })
  }, [])

  return mapboxgl
}

// ---------------------------------------------------------------------------
// Mapbox access token (client-safe VITE_ prefix)
// ---------------------------------------------------------------------------

const MAPBOX_TOKEN = (import.meta.env as unknown as Record<string, string | undefined>)
  .VITE_MAPBOX_TOKEN ?? ''

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the earliest start_date across all riders.
 * Returns epoch in seconds.
 */
function getEarliestStartEpoch(riders: GroupRideDetailRider[]): number {
  let earliest = Infinity
  for (const rider of riders) {
    const epoch = new Date(rider.ride.start_date).getTime() / 1000
    if (epoch < earliest) earliest = epoch
  }
  return earliest
}

/**
 * Get rider initials from display name (max 2 chars).
 */
function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return displayName.slice(0, 2).toUpperCase()
}

/**
 * Linearly interpolate position along a rider's latlng stream.
 *
 * @param riderTime - seconds into this rider's own time stream (currentTime - offset)
 * @param timeStream - rider's time samples (seconds from their start)
 * @param latlngStream - rider's GPS coords matching timeStream indices
 * @returns interpolated [lat, lng] or null if out of range
 */
function interpolatePosition(
  riderTime: number,
  timeStream: number[],
  latlngStream: [number, number][],
): [number, number] | null {
  if (timeStream.length === 0 || latlngStream.length === 0) return null
  if (riderTime < timeStream[0] || riderTime > timeStream[timeStream.length - 1]) return null

  // Binary search for the bracket
  let lo = 0
  let hi = timeStream.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (timeStream[mid] <= riderTime) lo = mid
    else hi = mid
  }

  // Exact match or single-point bracket
  if (lo === hi || timeStream[lo] === timeStream[hi]) {
    return latlngStream[lo]
  }

  // Linear interpolation factor
  const t = (riderTime - timeStream[lo]) / (timeStream[hi] - timeStream[lo])
  const lat = latlngStream[lo][0] + t * (latlngStream[hi][0] - latlngStream[lo][0])
  const lng = latlngStream[lo][1] + t * (latlngStream[hi][1] - latlngStream[lo][1])
  return [lat, lng]
}

/**
 * Compute bounding box for a set of [lat, lng] coordinates.
 * Returns [[south, west], [north, east]].
 */
function computeBounds(
  coords: [number, number][],
): [[number, number], [number, number]] | null {
  if (coords.length === 0) return null

  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity

  for (const [lat, lng] of coords) {
    if (lat < south) south = lat
    if (lat > north) north = lat
    if (lng < west) west = lng
    if (lng > east) east = lng
  }

  return [
    [south, west],
    [north, east],
  ]
}

// ---------------------------------------------------------------------------
// Marker DOM creation (uses DOM API for security — no innerHTML)
// ---------------------------------------------------------------------------

/**
 * Create a circular marker DOM element for a rider.
 * Uses DOM API (createElement, textContent) instead of innerHTML for XSS safety.
 */
function createMarkerElement(rider: PreparedRider): HTMLDivElement {
  const size = 32
  const container = document.createElement('div')
  container.className = 'group-ride-map__marker'
  container.style.width = `${size}px`
  container.style.height = `${size}px`
  container.style.borderRadius = '50%'
  container.style.border = `3px solid ${rider.color}`
  container.style.overflow = 'hidden'
  container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)'
  container.style.cursor = 'pointer'
  container.style.transition = 'opacity 0.3s ease'

  if (rider.avatarUrl) {
    const img = document.createElement('img')
    img.src = rider.avatarUrl
    img.alt = rider.displayName
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.objectFit = 'cover'
    img.style.display = 'block'
    container.appendChild(img)
  } else {
    // Fallback: gradient background with initials
    container.style.background = `linear-gradient(135deg, ${rider.color}, ${rider.color}88)`
    container.style.display = 'flex'
    container.style.alignItems = 'center'
    container.style.justifyContent = 'center'

    const initialsEl = document.createElement('span')
    initialsEl.textContent = getInitials(rider.displayName)
    initialsEl.style.color = '#ffffff'
    initialsEl.style.fontSize = '11px'
    initialsEl.style.fontWeight = '700'
    initialsEl.style.fontFamily = 'Inter, sans-serif'
    initialsEl.style.lineHeight = '1'
    container.appendChild(initialsEl)
  }

  return container
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupRideMap({ riders, currentTime, isPlaying }: GroupRideMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map())
  const initialFitDoneRef = useRef(false)
  const mapboxgl = useMapboxGL()

  // -------------------------------------------------------------------------
  // Prepare rider data (filter out those without streams, compute offsets)
  // -------------------------------------------------------------------------

  const preparedRiders = useMemo((): PreparedRider[] => {
    const earliestEpoch = getEarliestStartEpoch(riders)
    const result: PreparedRider[] = []
    let colorIdx = 0

    for (const rider of riders) {
      if (!rider.streams || rider.streams.latlng.length === 0 || rider.streams.time.length === 0) {
        continue
      }

      const riderEpoch = new Date(rider.ride.start_date).getTime() / 1000
      const offset = riderEpoch - earliestEpoch
      const timeStream = rider.streams.time
      const duration = timeStream[timeStream.length - 1] - timeStream[0]

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
      })
      colorIdx++
    }

    return result
  }, [riders])

  // -------------------------------------------------------------------------
  // Initialize the map
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!mapboxgl || !containerRef.current || mapRef.current) return
    if (!MAPBOX_TOKEN) {
      // eslint-disable-next-line no-console
      console.warn('[GroupRideMap] VITE_MAPBOX_TOKEN is not set — map will not render.')
      return
    }

    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-122.4, 37.6] as [number, number],
      zoom: 10,
      attributionControl: true,
    })

    mapRef.current = map

    map.on('load', () => {
      // Add polyline sources and layers for each rider
      for (const rider of preparedRiders) {
        const sourceId = `route-${rider.userId}`
        const layerId = `route-layer-${rider.userId}`

        // Convert latlng [lat, lng] to GeoJSON [lng, lat]
        const coordinates = rider.latlng.map(([lat, lng]: [number, number]) => [lng, lat])

        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates,
            },
          },
        })

        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': rider.color,
            'line-width': 3,
            'line-opacity': 0.7,
          },
        })
      }

      // Initial camera: fit to all polylines
      const allCoords: [number, number][] = []
      for (const rider of preparedRiders) {
        for (const coord of rider.latlng) {
          allCoords.push(coord)
        }
      }

      const bounds = computeBounds(allCoords)
      if (bounds) {
        // mapbox fitBounds expects [[west, south], [east, north]] i.e. [lng, lat]
        map.fitBounds(
          [
            [bounds[0][1], bounds[0][0]], // [west, south]
            [bounds[1][1], bounds[1][0]], // [east, north]
          ],
          { padding: 60, duration: 0 },
        )
      }

      initialFitDoneRef.current = true
    })

    return () => {
      // Cleanup markers
      for (const marker of markersRef.current.values()) {
        marker.remove()
      }
      markersRef.current.clear()
      map.remove()
      mapRef.current = null
      initialFitDoneRef.current = false
    }
  }, [mapboxgl, preparedRiders])

  // -------------------------------------------------------------------------
  // Update marker positions on currentTime change
  // -------------------------------------------------------------------------

  const updateMarkers = useCallback(() => {
    const map = mapRef.current
    if (!map || !mapboxgl || !initialFitDoneRef.current) return

    const activePositions: [number, number][] = []

    for (const rider of preparedRiders) {
      const riderTime = currentTime - rider.offset
      const position = interpolatePosition(riderTime, rider.time, rider.latlng)

      let marker = markersRef.current.get(rider.userId)

      if (position) {
        // Rider is active at this time
        activePositions.push(position)

        if (!marker) {
          // Create marker
          const el = createMarkerElement(rider)
          marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([position[1], position[0]])
            .addTo(map)
          markersRef.current.set(rider.userId, marker)
        } else {
          // Update position
          marker.setLngLat([position[1], position[0]])
          const el = marker.getElement()
          if (el) el.style.opacity = '1'
        }
      } else if (marker) {
        // Rider not active — hide marker
        const el = marker.getElement()
        if (el) el.style.opacity = '0'
      }
    }

    // Camera: fit to active rider positions while playing
    if (isPlaying && activePositions.length > 0) {
      const bounds = computeBounds(activePositions)
      if (bounds) {
        const sw: [number, number] = [bounds[0][1], bounds[0][0]]
        const ne: [number, number] = [bounds[1][1], bounds[1][0]]

        // Only refit if bounds have meaningful size
        const lngSpan = Math.abs(ne[0] - sw[0])
        const latSpan = Math.abs(ne[1] - sw[1])
        if (lngSpan > 0.0001 || latSpan > 0.0001) {
          map.fitBounds([sw, ne], {
            padding: 80,
            duration: 1000,
            maxZoom: 15,
          })
        }
      }
    }
  }, [mapboxgl, preparedRiders, currentTime, isPlaying])

  useEffect(() => {
    updateMarkers()
  }, [updateMarkers])

  // -------------------------------------------------------------------------
  // Inject Mapbox GL CSS on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    const existingLink = document.querySelector('link[href*="mapbox-gl"]')
    if (existingLink) return

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css'
    document.head.appendChild(link)

    return () => {
      if (link.parentNode) {
        document.head.removeChild(link)
      }
    }
  }, [])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!MAPBOX_TOKEN) {
    return (
      <div className="group-ride-map group-ride-map--error">
        <p className="group-ride-map__error-text">
          Map unavailable — Mapbox token not configured.
        </p>
      </div>
    )
  }

  if (preparedRiders.length === 0) {
    return (
      <div className="group-ride-map group-ride-map--empty">
        <p className="group-ride-map__empty-text">
          No GPS data available for this group ride.
        </p>
      </div>
    )
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
  )
}
