/**
 * WindMap — Wind speed and direction visualization on a real map.
 *
 * Fetches a grid of wind data from Open-Meteo for several points across
 * the SF Bay Area and renders directional arrows overlaid on Carto
 * basemap tiles. Arrow length and color indicate wind speed.
 */
import { useQuery } from '@tanstack/react-query'
import { useRef, useEffect, useState } from 'react'
import { fetchWindGrid } from '../server/forecast'
import { Tooltip } from './Tooltip'

/** Compass direction from degrees */
function compassDir(deg: number): string {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ]
  return dirs[Math.round(deg / 22.5) % 16]
}

/** Wind speed color scale */
function getWindColor(speed: number): string {
  if (speed < 5) return '#22c55e'   // green
  if (speed < 10) return '#a3e635'  // lime
  if (speed < 15) return '#eab308'  // yellow
  if (speed < 20) return '#f97316'  // orange
  return '#ef4444'                   // red
}

/** Arrow length scale based on wind speed (min 10, max 28 px) */
function getArrowLength(speed: number): number {
  return Math.min(28, Math.max(10, 8 + speed * 1.2))
}

interface WindMapProps {
  date: string
  hour: number
}

// Map configuration
const MAP_BOUNDS = {
  north: 37.85,
  south: 37.35,
  east: -122.05,
  west: -122.55,
}
const ZOOM = 11
const MAP_WIDTH = 600
const MAP_HEIGHT = 480

/**
 * Convert lat/lng to pixel position within our map bounds.
 */
function lngToX(lng: number): number {
  return ((lng - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * MAP_WIDTH
}
function latToY(lat: number): number {
  return ((MAP_BOUNDS.north - lat) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * MAP_HEIGHT
}

/**
 * Convert lat/lng to slippy map tile coordinates.
 * See: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */
function latlngToTile(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return { x, y }
}

/**
 * Convert tile coordinates back to lat/lng (NW corner of tile).
 */
function tileToLatLng(x: number, y: number, zoom: number) {
  const n = Math.pow(2, zoom)
  const lng = (x / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))
  const lat = (latRad * 180) / Math.PI
  return { lat, lng }
}

/**
 * Get Carto basemap tile URL.
 * Using dark_all for dark mode compatibility, light_all for light.
 * These are already allowed by the CSP (basemaps.cartocdn.com).
 */
function getTileUrl(x: number, y: number, z: number): string {
  // Use dark_nolabels for cleaner look with our own labels
  return `https://basemaps.cartocdn.com/dark_nolabels/${z}/${x}/${y}@2x.png`
}

export function WindMap({ date, hour }: WindMapProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['wind-grid', date, hour],
    queryFn: () => fetchWindGrid({ data: { date, hour } }),
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tilesLoaded, setTilesLoaded] = useState(false)

  // Render map tiles onto canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Calculate tile range
    const tileNW = latlngToTile(MAP_BOUNDS.north, MAP_BOUNDS.west, ZOOM)
    const tileSE = latlngToTile(MAP_BOUNDS.south, MAP_BOUNDS.east, ZOOM)

    const tilesX = tileSE.x - tileNW.x + 1
    const tilesY = tileSE.y - tileNW.y + 1

    // Tile pixel size (Carto @2x tiles are 512px)
    const tilePixels = 512

    // Calculate the pixel coordinates of our map bounds within the tile grid
    const nwCorner = tileToLatLng(tileNW.x, tileNW.y, ZOOM)
    const seCorner = tileToLatLng(tileSE.x + 1, tileSE.y + 1, ZOOM)

    const totalPixelWidth = tilesX * tilePixels
    const totalPixelHeight = tilesY * tilePixels

    // Offset of our viewport within the tile grid
    const offsetX = ((MAP_BOUNDS.west - nwCorner.lng) / (seCorner.lng - nwCorner.lng)) * totalPixelWidth
    const offsetY = ((nwCorner.lat - MAP_BOUNDS.north) / (nwCorner.lat - seCorner.lat)) * totalPixelHeight

    const scaleX = MAP_WIDTH / (((MAP_BOUNDS.east - MAP_BOUNDS.west) / (seCorner.lng - nwCorner.lng)) * totalPixelWidth)
    const scaleY = MAP_HEIGHT / (((MAP_BOUNDS.north - MAP_BOUNDS.south) / (nwCorner.lat - seCorner.lat)) * totalPixelHeight)

    // Fill with dark background
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT)

    let loadedCount = 0
    const totalTiles = tilesX * tilesY

    for (let tx = 0; tx < tilesX; tx++) {
      for (let ty = 0; ty < tilesY; ty++) {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const drawX = (tx * tilePixels + offsetX * -1) * scaleX
          const drawY = (ty * tilePixels + offsetY * -1) * scaleY
          const drawW = tilePixels * scaleX
          const drawH = tilePixels * scaleY

          ctx.drawImage(img, drawX, drawY, drawW, drawH)
          loadedCount++
          if (loadedCount >= totalTiles) {
            setTilesLoaded(true)
          }
        }
        img.onerror = () => {
          loadedCount++
          if (loadedCount >= totalTiles) {
            setTilesLoaded(true)
          }
        }
        img.src = getTileUrl(tileNW.x + tx, tileNW.y + ty, ZOOM)
      }
    }
  }, [])

  if (isLoading) {
    return (
      <div className="wind-map">
        <h3 className="wind-map__title">🗺️ Regional Wind Map</h3>
        <div className="wind-map__loading">Loading wind data…</div>
      </div>
    )
  }

  if (!data || data.length === 0) return null

  return (
    <div className="wind-map">
      <h3 className="wind-map__title">🗺️ Regional Wind Map</h3>
      <p className="wind-map__subtitle">
        Wind conditions across the SF &amp; Peninsula area
      </p>
      <div className="wind-map__container">
        {/* Tile-based map background */}
        <canvas
          ref={canvasRef}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          className="wind-map__canvas"
        />

        {/* SVG overlay with wind arrows */}
        <svg
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          className="wind-map__overlay"
          role="img"
          aria-label="Regional wind map showing wind speed and direction across the San Francisco Bay Area"
        >
          {/* Geographic labels */}
          <text x={lngToX(-122.42)} y={latToY(37.79)} fill="#ffffff" fontSize={12} fontWeight={700} opacity={0.7}>
            San Francisco
          </text>
          <text x={lngToX(-122.32)} y={latToY(37.56)} fill="#ffffff" fontSize={10} fontWeight={600} opacity={0.5}>
            San Mateo
          </text>
          <text x={lngToX(-122.20)} y={latToY(37.44)} fill="#ffffff" fontSize={10} fontWeight={600} opacity={0.5}>
            Palo Alto
          </text>
          <text x={lngToX(-122.50)} y={latToY(37.60)} fill="#ffffff" fontSize={10} fontWeight={600} opacity={0.5}>
            Pacifica
          </text>

          {/* Wind arrows at each grid point */}
          {data.map((point, i) => {
            const x = lngToX(point.lng)
            const y = latToY(point.lat)
            const color = getWindColor(point.windSpeed)
            const arrowLen = getArrowLength(point.windSpeed)
            const halfLen = arrowLen / 2

            return (
              <g key={i}>
                <Tooltip
                  content={`${point.label}: ${point.windSpeed.toFixed(1)} mph from ${compassDir(point.windDirection)} (gusts ${point.windGusts.toFixed(0)} mph)`}
                >
                  <g>
                    <g transform={`translate(${x}, ${y})`}>
                      {/* Glow circle behind arrow */}
                      <circle r={halfLen + 4} fill={color} fillOpacity={0.12} />

                      {/* Wind arrow — rotated to show direction wind is coming FROM */}
                      <g transform={`rotate(${point.windDirection}, 0, 0)`}>
                        <line
                          x1={0}
                          y1={-halfLen}
                          x2={0}
                          y2={halfLen}
                          stroke={color}
                          strokeWidth={2.5}
                          strokeLinecap="round"
                        />
                        <polyline
                          points={`${-halfLen * 0.4},${-halfLen * 0.4} 0,${-halfLen} ${halfLen * 0.4},${-halfLen * 0.4}`}
                          fill="none"
                          stroke={color}
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>

                      {/* Speed label */}
                      <text
                        x={0}
                        y={halfLen + 14}
                        textAnchor="middle"
                        fill={color}
                        fontSize={10}
                        fontWeight={700}
                        fontFamily="var(--font-mono)"
                      >
                        {Math.round(point.windSpeed)}
                      </text>
                    </g>
                  </g>
                </Tooltip>
              </g>
            )
          })}
        </svg>

        {/* Legend */}
        <div className="wind-map__legend">
          <span className="wind-map__legend-title">Wind Speed (mph)</span>
          <div className="wind-map__legend-items">
            <span className="wind-map__legend-item">
              <span className="wind-map__legend-dot" style={{ background: '#22c55e' }} />
              &lt;5
            </span>
            <span className="wind-map__legend-item">
              <span className="wind-map__legend-dot" style={{ background: '#a3e635' }} />
              5–10
            </span>
            <span className="wind-map__legend-item">
              <span className="wind-map__legend-dot" style={{ background: '#eab308' }} />
              10–15
            </span>
            <span className="wind-map__legend-item">
              <span className="wind-map__legend-dot" style={{ background: '#f97316' }} />
              15–20
            </span>
            <span className="wind-map__legend-item">
              <span className="wind-map__legend-dot" style={{ background: '#ef4444' }} />
              20+
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
