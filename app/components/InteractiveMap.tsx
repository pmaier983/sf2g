/**
 * Interactive map visualizations for the SF2G routes page.
 *
 * Three map sections:
 * 1. Commute Zone — SF bounds, Peninsula corridor, PPR start point
 * 2. Company Offices — All tech company HQ locations
 * 3. Route Gateways — All checkpoint locations with 500m radius circles
 *
 * Uses Leaflet with OpenStreetMap tiles (free, no API key needed).
 * Wrapped in a client-only guard for SSR safety.
 */
import { useEffect, useRef, useState } from 'react'
import type L from 'leaflet'
import {
  ROUTE_GATEWAYS,
  GATEWAY_RADIUS_METERS,
  ROUTE_COLORS,
  ROUTE_LABELS,
  SF_BOUNDS,
  PENINSULA_CORRIDOR,
  PPR_COORDS,
} from '../lib/constants'
import {
  OFFICE_LOCATIONS,
  COMPANY_COLORS,
  COMPANY_LABELS,
  DESTINATION_RADIUS_METERS,
  type DestinationCompany,
} from '../lib/office-locations'

// ---------------------------------------------------------------------------
// Tile layer URL (OpenStreetMap — dark-friendly via CartoDB)
// ---------------------------------------------------------------------------

const TILE_LIGHT =
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const TILE_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'

// ---------------------------------------------------------------------------
// Shared hook: dynamically import Leaflet (avoids SSR window issues)
// ---------------------------------------------------------------------------

function useLeaflet() {
  const [leaflet, setLeaflet] = useState<typeof L | null>(null)

  useEffect(() => {
    import('leaflet').then((mod) => {
      setLeaflet(mod.default)
    })
  }, [])

  return leaflet
}

function useTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const html = document.documentElement
    setTheme(html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')

    const observer = new MutationObserver(() => {
      setTheme(html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    })
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}

// ---------------------------------------------------------------------------
// Helper: create a circle marker (custom HTML for better styling)
// ---------------------------------------------------------------------------

function createCircleIcon(
  LLib: typeof L,
  color: string,
  size = 14,
): L.DivIcon {
  return LLib.divIcon({
    className: 'sf2g-marker',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/**
 * Company logo SVG paths (simple, recognisable glyphs).
 * Rendered inside a 24×24 white circle with the company brand color bg.
 */
const COMPANY_ICON_SVGS: Record<DestinationCompany, string> = {
  netflix: `<text x="12" y="17" font-family="Arial,sans-serif" font-weight="900" font-size="16" fill="white" text-anchor="middle">N</text>`,
  google: `<text x="12" y="17" font-family="Arial,sans-serif" font-weight="900" font-size="16" fill="white" text-anchor="middle">G</text>`,
  apple: `<text x="12" y="17" font-family="Arial,sans-serif" font-size="16" fill="white" text-anchor="middle">&#xf8ff;</text>`,
  meta: `<text x="12" y="17" font-family="Arial,sans-serif" font-weight="900" font-size="14" fill="white" text-anchor="middle">M</text>`,
  nvidia: `<text x="12" y="17" font-family="Arial,sans-serif" font-weight="900" font-size="12" fill="white" text-anchor="middle">NV</text>`,
  stanford: `<text x="12" y="17" font-family="Arial,sans-serif" font-weight="900" font-size="16" fill="white" text-anchor="middle">S</text>`,
  tesla: `<text x="12" y="17" font-family="Arial,sans-serif" font-weight="900" font-size="16" fill="white" text-anchor="middle">T</text>`,
}

function createCompanyIcon(
  LLib: typeof L,
  company: DestinationCompany,
  color: string,
  isClosed = false,
): L.DivIcon {
  const size = isClosed ? 20 : 26
  const svg = COMPANY_ICON_SVGS[company]
  const opacity = isClosed ? '0.6' : '1'

  return LLib.divIcon({
    className: 'sf2g-company-marker',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${color};
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: ${opacity};
    ">
      <svg viewBox="0 0 24 24" width="${size - 4}" height="${size - 4}">
        ${svg}
      </svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function createLabelIcon(
  LLib: typeof L,
  label: string,
  color: string,
): L.DivIcon {
  return LLib.divIcon({
    className: 'sf2g-label-marker',
    html: `<div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    ">
      <div style="
        width: 14px;
        height: 14px;
        background: ${color};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      "></div>
      <span style="
        font-family: Inter, sans-serif;
        font-size: 10px;
        font-weight: 600;
        color: white;
        background: rgba(0,0,0,0.7);
        padding: 1px 6px;
        border-radius: 4px;
        white-space: nowrap;
        pointer-events: none;
      ">${label}</span>
    </div>`,
    iconSize: [14, 30],
    iconAnchor: [7, 7],
  })
}

// ---------------------------------------------------------------------------
// Map 1: Commute Zone
// ---------------------------------------------------------------------------

interface MapSectionProps {
  id: string
  title: string
  description: string
  children: React.ReactNode
}

function MapSection({ id, title, description, children }: MapSectionProps) {
  return (
    <div className="map-section glass-card" id={id}>
      <div className="map-section__header">
        <h3 className="map-section__title">{title}</h3>
        <p className="map-section__desc">{description}</p>
      </div>
      <div className="map-section__container">{children}</div>
    </div>
  )
}

function CommuteZoneMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const L = useLeaflet()
  const theme = useTheme()

  useEffect(() => {
    if (!L || !containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([37.55, -122.25], 10)

    L.tileLayer(theme === 'dark' ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(map)

    // SF bounding box (blue rectangle)
    L.rectangle(
      [
        [SF_BOUNDS.south, SF_BOUNDS.west],
        [SF_BOUNDS.north, SF_BOUNDS.east],
      ],
      {
        color: '#3B82F6',
        weight: 2,
        fillColor: '#3B82F6',
        fillOpacity: 0.15,
        dashArray: '8, 4',
      },
    )
      .addTo(map)
      .bindPopup(
        '<strong>San Francisco Zone</strong><br/>Rides must start (or end) here to qualify as an SF2G commute.',
      )

    // Peninsula corridor polygon (green)
    L.polygon(PENINSULA_CORRIDOR as [number, number][], {
      color: '#10B981',
      weight: 2,
      fillColor: '#10B981',
      fillOpacity: 0.12,
      dashArray: '6, 4',
    })
      .addTo(map)
      .bindPopup(
        '<strong>Peninsula Corridor</strong><br/>Between Hwy 280 (west) and Hwy 101 (east), with ~1 mile buffer. Rides must end (or start) here.',
      )

    // PPR start point
    L.marker([PPR_COORDS.lat, PPR_COORDS.lng], {
      icon: createLabelIcon(L, 'PPR ☕', '#fc4c02'),
    })
      .addTo(map)
      .bindPopup(
        "<strong>PPR — Peet's Coffee</strong><br/>Park Presidio & Geary. The classic SF2G morning departure point.",
      )

    // Add labels for the zones
    L.marker([37.76, -122.43], {
      icon: L.divIcon({
        className: 'sf2g-zone-label',
        html: '<div style="font-family:Inter,sans-serif;font-size:13px;font-weight:700;color:#3B82F6;text-shadow:0 1px 3px rgba(0,0,0,0.5);white-space:nowrap;">SAN FRANCISCO</div>',
        iconSize: [120, 20],
        iconAnchor: [60, 10],
      }),
    }).addTo(map)

    L.marker([37.45, -122.15], {
      icon: L.divIcon({
        className: 'sf2g-zone-label',
        html: '<div style="font-family:Inter,sans-serif;font-size:13px;font-weight:700;color:#10B981;text-shadow:0 1px 3px rgba(0,0,0,0.5);white-space:nowrap;">PENINSULA CORRIDOR</div>',
        iconSize: [160, 20],
        iconAnchor: [80, 10],
      }),
    }).addTo(map)

    // Arrow showing direction
    L.marker([37.65, -122.35], {
      icon: L.divIcon({
        className: 'sf2g-zone-label',
        html: '<div style="font-family:Inter,sans-serif;font-size:20px;text-shadow:0 1px 3px rgba(0,0,0,0.5);">🚴‍♂️ ↓</div>',
        iconSize: [40, 30],
        iconAnchor: [20, 15],
      }),
    }).addTo(map)

    mapRef.current = map

    // Fit bounds to show both zones
    const corridorEastLng = Math.max(...PENINSULA_CORRIDOR.map((v) => v[1]))
    const corridorSouthLat = Math.min(...PENINSULA_CORRIDOR.map((v) => v[0]))
    map.fitBounds([
      [corridorSouthLat - 0.05, SF_BOUNDS.west - 0.05],
      [SF_BOUNDS.north + 0.02, corridorEastLng + 0.05],
    ])

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [L]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update tiles when theme changes
  useEffect(() => {
    if (!mapRef.current || !L) return
    mapRef.current.eachLayer((layer) => {
      if ((layer as any)._url?.includes('cartocdn')) {
        mapRef.current!.removeLayer(layer)
      }
    })
    L.tileLayer(theme === 'dark' ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(mapRef.current)
  }, [theme, L])

  return <div ref={containerRef} className="map-section__map" />
}

// ---------------------------------------------------------------------------
// Map 2: Company Offices
// ---------------------------------------------------------------------------

function CompanyOfficesMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const L = useLeaflet()
  const theme = useTheme()

  useEffect(() => {
    if (!L || !containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([37.45, -122.05], 10)

    L.tileLayer(theme === 'dark' ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(map)

    // Group offices by company for layering
    const companies: DestinationCompany[] = [
      'netflix',
      'google',
      'apple',
      'meta',
      'nvidia',
      'stanford',
      'tesla',
    ]

    for (const company of companies) {
      const offices = OFFICE_LOCATIONS.filter((o) => o.company === company)
      const color = COMPANY_COLORS[company]

      for (const office of offices) {
        const radius = office.radiusMeters ?? DESTINATION_RADIUS_METERS
        // Destination radius circle
        L.circle([office.lat, office.lng], {
          radius,
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.15,
        }).addTo(map)

        // Office marker (company-branded icon)
        const statusIcon = office.status === 'closed' ? ' ⛔' : ''
        L.marker([office.lat, office.lng], {
          icon: createCompanyIcon(L, company, color, office.status === 'closed'),
        })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:Inter,sans-serif;">
              <strong style="color:${color}">${COMPANY_LABELS[company]}</strong>${statusIcon}<br/>
              <span style="font-size:13px;font-weight:600;">${office.name}</span><br/>
              <span style="font-size:12px;color:#666;">${office.address}, ${office.city}</span><br/>
              <span style="font-size:11px;color:#888;">Status: ${office.status === 'active' ? '✅ Active' : '❌ Closed'}</span><br/>
              <span style="font-size:11px;color:#888;">Match radius: ${radius}m</span>
            </div>`,
          )
      }
    }

    mapRef.current = map

    // Fit to show all offices
    const allCoords = OFFICE_LOCATIONS.map(
      (o) => [o.lat, o.lng] as [number, number],
    )
    map.fitBounds(L.latLngBounds(allCoords).pad(0.1))

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [L]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapRef.current || !L) return
    mapRef.current.eachLayer((layer) => {
      if ((layer as any)._url?.includes('cartocdn')) {
        mapRef.current!.removeLayer(layer)
      }
    })
    L.tileLayer(theme === 'dark' ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(mapRef.current)
  }, [theme, L])

  return <div ref={containerRef} className="map-section__map" />
}

// ---------------------------------------------------------------------------
// Map 3: Route Gateways
// ---------------------------------------------------------------------------

function GatewayCheckpointsMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const L = useLeaflet()
  const theme = useTheme()

  useEffect(() => {
    if (!L || !containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([37.58, -122.38], 11)

    L.tileLayer(theme === 'dark' ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(map)

    // Draw gateways with radius circles and connecting lines
    const gatewaysByCategory = new Map<string, typeof ROUTE_GATEWAYS>()
    for (const gw of ROUTE_GATEWAYS) {
      const list = gatewaysByCategory.get(gw.category) ?? []
      list.push(gw)
      gatewaysByCategory.set(gw.category, list)
    }

    for (const [category, gateways] of gatewaysByCategory) {
      const color =
        ROUTE_COLORS[category as keyof typeof ROUTE_COLORS] ?? '#6B7280'
      const label =
        ROUTE_LABELS[category as keyof typeof ROUTE_LABELS] ?? category

      // Draw connecting line between the two gateways
      if (gateways.length === 2) {
        L.polyline(
          gateways.map((g) => [g.lat, g.lng] as [number, number]),
          {
            color,
            weight: 2,
            opacity: 0.5,
            dashArray: '6, 6',
          },
        ).addTo(map)
      }

      for (const gw of gateways) {
        // 500m radius circle
        L.circle([gw.lat, gw.lng], {
          radius: GATEWAY_RADIUS_METERS,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.15,
        }).addTo(map)

        // Gateway marker with label
        L.marker([gw.lat, gw.lng], {
          icon: createLabelIcon(L, gw.name.split('(')[0].trim(), color),
        })
          .addTo(map)
          .bindPopup(
            `<div style="font-family:Inter,sans-serif;">
              <strong style="color:${color}">${label} Route</strong><br/>
              <span style="font-size:13px;font-weight:600;">${gw.name}</span><br/>
              <span style="font-size:12px;color:#666;">${gw.description}</span><br/>
              <span style="font-size:11px;color:#888;">Match radius: ${GATEWAY_RADIUS_METERS}m</span><br/>
              <span style="font-size:11px;color:#888;">Coords: ${gw.lat.toFixed(4)}, ${gw.lng.toFixed(4)}</span>
            </div>`,
          )
      }
    }

    // Also show PPR as context
    L.marker([PPR_COORDS.lat, PPR_COORDS.lng], {
      icon: createLabelIcon(L, 'PPR ☕', '#fc4c02'),
    })
      .addTo(map)
      .bindPopup(
        "<strong>PPR — Peet's Coffee</strong><br/>The classic SF2G departure point.",
      )

    mapRef.current = map

    // Fit bounds to show all gateways + PPR
    const allCoords = [
      ...ROUTE_GATEWAYS.map((g) => [g.lat, g.lng] as [number, number]),
      [PPR_COORDS.lat, PPR_COORDS.lng] as [number, number],
    ]
    map.fitBounds(L.latLngBounds(allCoords).pad(0.12))

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [L]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapRef.current || !L) return
    mapRef.current.eachLayer((layer) => {
      if ((layer as any)._url?.includes('cartocdn')) {
        mapRef.current!.removeLayer(layer)
      }
    })
    L.tileLayer(theme === 'dark' ? TILE_DARK : TILE_LIGHT, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
    }).addTo(mapRef.current)
  }, [theme, L])

  return <div ref={containerRef} className="map-section__map" />
}

// ---------------------------------------------------------------------------
// Legend Components
// ---------------------------------------------------------------------------

function CommuteZoneLegend() {
  return (
    <div className="map-legend">
      <div className="map-legend__item">
        <span
          className="map-legend__swatch map-legend__swatch--dashed"
          style={{ borderColor: '#3B82F6', background: 'rgba(59,130,246,0.15)' }}
        />
        <span>San Francisco (start/end zone)</span>
      </div>
      <div className="map-legend__item">
        <span
          className="map-legend__swatch map-legend__swatch--dashed"
          style={{
            borderColor: '#10B981',
            background: 'rgba(16,185,129,0.12)',
          }}
        />
        <span>Peninsula Corridor (start/end zone)</span>
      </div>
      <div className="map-legend__item">
        <span
          className="map-legend__dot"
          style={{ background: '#fc4c02' }}
        />
        <span>PPR — Classic departure point</span>
      </div>
    </div>
  )
}

function CompanyLegend() {
  const companies: DestinationCompany[] = [
    'google',
    'apple',
    'meta',
    'nvidia',
    'netflix',
    'stanford',
    'tesla',
  ]
  return (
    <div className="map-legend">
      {companies.map((c) => (
        <div key={c} className="map-legend__item">
          <span
            className="map-legend__dot"
            style={{ background: COMPANY_COLORS[c] }}
          />
          <span>
            {COMPANY_LABELS[c]}{' '}
            <span className="text-muted">
              ({OFFICE_LOCATIONS.filter((o) => o.company === c).length} offices)
            </span>
          </span>
        </div>
      ))}
      <div className="map-legend__item map-legend__item--note">
        <span className="map-legend__circle-outline" />
        <span>
          {DESTINATION_RADIUS_METERS}m default match radius (Stanford: 2000m) — ride must end within this circle
        </span>
      </div>
    </div>
  )
}

function GatewayLegend() {
  const routes: Array<{
    category: keyof typeof ROUTE_COLORS
    label: string
  }> = [
    { category: 'skyline', label: 'Skyline' },
    { category: 'bayway', label: 'Bayway' },
    { category: 'hmbw', label: 'HMBW' },
    { category: 'royale', label: 'Royale' },
    { category: 'fleaway', label: 'Fleaway' },
    { category: 'mebw', label: 'MEBW' },
    { category: 'febw', label: 'FEBW' },
  ]
  return (
    <div className="map-legend">
      {routes.map((r) => (
        <div key={r.category} className="map-legend__item">
          <span
            className="map-legend__dot"
            style={{ background: ROUTE_COLORS[r.category] }}
          />
          <span>{r.label}</span>
        </div>
      ))}
      <div className="map-legend__item map-legend__item--note">
        <span className="map-legend__circle-outline" />
        <span>
          {GATEWAY_RADIUS_METERS}m radius — any polyline point within this circle counts as a hit
        </span>
      </div>
      <div className="map-legend__item map-legend__item--note">
        <span style={{ width: 16, borderTop: '2px dashed var(--color-text-muted)', marginRight: 2 }} />
        <span>
          Dashed line connects North ↔ South gateways for each route
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function InteractiveMaps() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Import Leaflet CSS (side-effect)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
    link.crossOrigin = ''
    document.head.appendChild(link)
    setMounted(true)
    return () => {
      document.head.removeChild(link)
    }
  }, [])

  if (!mounted) {
    return (
      <div className="map-section glass-card">
        <div className="map-section__header">
          <h3 className="map-section__title">Loading maps...</h3>
        </div>
        <div className="map-section__container">
          <div className="map-section__map skeleton" />
        </div>
      </div>
    )
  }

  return (
    <div className="interactive-maps">
      <div className="interactive-maps__header animate-fade-in">
        <h2 className="interactive-maps__title">
          📍 Interactive Maps
        </h2>
        <p className="interactive-maps__subtitle">
          Explore the zones, offices, and checkpoints that power SF2G ride classification.
        </p>
      </div>

      <MapSection
        id="map-commute-zone"
        title="🗺️ SF2G Commute Zone"
        description="A ride qualifies as an SF2G commute if one endpoint is in San Francisco and the other is in the Peninsula Corridor (between Hwy 280 and Hwy 101, from Daly City to San Jose)."
      >
        <CommuteZoneMap />
        <CommuteZoneLegend />
      </MapSection>

      <MapSection
        id="map-company-offices"
        title="🏢 Commute Endpoints"
        description="Rides ending within the match radius of any endpoint are counted toward the leaderboard. Default radius is 1000m (Stanford: 2000m). Both active and closed locations are tracked — past commutes still count."
      >
        <CompanyOfficesMap />
        <CompanyLegend />
      </MapSection>

      <MapSection
        id="map-gateway-checkpoints"
        title="🎯 Route Gateway Checkpoints"
        description="Each route corridor has two GPS checkpoints. Your ride's decoded GPS track is checked against these — if any point passes within 500m of a checkpoint, it counts as a gateway hit."
      >
        <GatewayCheckpointsMap />
        <GatewayLegend />
      </MapSection>
    </div>
  )
}
