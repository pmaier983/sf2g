import { createColumnHelper } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import type { RowData } from '@tanstack/react-table'
import type { LeaderboardEntry, RouteCategory } from '../lib/database.types'
import { safeNumber, formatDistance, formatElevation, formatSpeed, formatRideDate } from '../lib/leaderboard-utils'
import { msToMph } from '../lib/wind'
import type { UnitSystem } from './UnitToggle'
import { TinyPie } from './TinyPie'
import { ROUTE_LABELS } from '../lib/constants'


/** Check if a rider has completed at least 1 ride on every main route (Bayway, Skyline, HMBW) */
function hasAllMainRoutes(row: LeaderboardEntry): boolean {
  return (
    safeNumber(row.bayway_count) > 0 &&
    safeNumber(row.skyline_count) > 0 &&
    safeNumber(row.hmbw_count) > 0
  )
}

/** Check if a rider has completed at least 1 ride on EVERY route variation */
function hasAllRouteVariations(row: LeaderboardEntry): boolean {
  return (
    safeNumber(row.bayway_count) > 0 &&
    safeNumber(row.skyline_count) > 0 &&
    safeNumber(row.hmbw_count) > 0 &&
    safeNumber(row.royale_count) > 0 &&
    safeNumber(row.fleaway_count) > 0 &&
    safeNumber(row.mebw_count) > 0 &&
    safeNumber(row.febw_count) > 0
  )
}

// Module augmentation for TanStack Table meta
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    onViewRides?: (userId: string, routeCategory?: RouteCategory) => void
  }
}

const columnHelper = createColumnHelper<LeaderboardEntry>()

/**
 * Renders a header label with a tooltip.
 */
function HeaderWithTooltip({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <span title={tooltip} style={{ cursor: 'help' }}>
      {label}
    </span>
  )
}

/**
 * Helper to build a route count cell with an accessible button.
 */
function routeCountCell(
  count: number,
  userId: string,
  displayName: string | null,
  routeCategory: RouteCategory,
  colorVar: string,
  meta: { onViewRides?: (userId: string, routeCategory?: RouteCategory) => void } | undefined,
) {
  if (count === 0) {
    return (
      <span className="leaderboard__route-count" style={{ color: 'var(--color-text-muted)' }}>
        0
      </span>
    )
  }
  const routeLabel = ROUTE_LABELS[routeCategory]
  return (
    <button
      className="leaderboard__count-btn"
      style={{ color: colorVar }}
      onClick={(e) => {
        e.stopPropagation()
        meta?.onViewRides?.(userId, routeCategory)
      }}
      type="button"
      aria-label={`View ${count} ${routeLabel} rides for ${displayName ?? 'rider'}`}
    >
      {count}
    </button>
  )
}



/**
 * Column definitions for the leaderboard table.
 */
export const leaderboardColumns = [
  columnHelper.display({
    id: 'rank',
    header: () => <HeaderWithTooltip label="#" tooltip="Rank by total SF2G commute rides" />,
    cell: (info) => (
      <span className="leaderboard__rank">{info.row.index + 1}</span>
    ),
    size: 48,
  }),
  columnHelper.accessor('avatar_url', {
    header: '',
    cell: (info) => {
      const url = info.getValue()
      return url ? (
        <img
          src={url}
          alt=""
          className="leaderboard__rider-avatar"
          loading="lazy"
        />
      ) : (
        <div
          className="leaderboard__rider-avatar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-surface-hover)',
            fontSize: '14px',
          }}
        >
          👤
        </div>
      )
    },
    size: 48,
    enableSorting: false,
  }),
  columnHelper.accessor('display_name', {
    header: () => <HeaderWithTooltip label="Rider" tooltip="Rider name (click to view profile)" />,
    cell: (info) => {
      const row = info.row.original
      const years = safeNumber(row.active_years)
      return (
        <span className="leaderboard__rider-cell">
          <Link
            to="/profile/$userId"
            params={{ userId: row.user_id }}
            className="leaderboard__rider-name"
          >
            {info.getValue() ?? row.username ?? 'Anonymous'}
          </Link>
          {hasAllRouteVariations(row) ? (
            <span
              className="leaderboard__badge leaderboard__badge--star leaderboard__badge--all-routes"
              title="Completed ALL route variations!"
              aria-label="All routes star"
            >
              🌟
            </span>
          ) : hasAllMainRoutes(row) ? (
            <span
              className="leaderboard__badge leaderboard__badge--star"
              title="Completed all main routes (Bayway, Skyline, HMBW)"
              aria-label="Main routes star"
            >
              ⭐
            </span>
          ) : null}
          {years > 1 && (
            <span
              className="leaderboard__badge leaderboard__badge--years"
              title={`Active for ${years} years`}
            >
              {years}y
            </span>
          )}
        </span>
      )
    },
    size: 200,
  }),
  columnHelper.accessor('sf2g_total', {
    header: () => <HeaderWithTooltip label="SF2G" tooltip="Total SF2G commute rides (click to view rides)" />,
    cell: (info) => (
      <button
        className="leaderboard__count-btn leaderboard__total"
        onClick={(e) => {
          e.stopPropagation()
          info.table.options.meta?.onViewRides?.(info.row.original.user_id)
        }}
        type="button"
        aria-label={`View all ${info.getValue()} rides for ${info.row.original.display_name ?? 'rider'}`}
      >
        {info.getValue()}
      </button>
    ),
    size: 72,
  }),
  columnHelper.accessor('active_years', {
    header: () => <HeaderWithTooltip label="Yrs" tooltip="Calendar years with at least 1 SF2G commute" />,
    cell: ({ getValue }) => {
      const years = safeNumber(getValue())
      return years > 0 ? years : '—'
    },
    size: 56,
    sortDescFirst: true,
  }),
  columnHelper.accessor('avg_speed_mps', {
    header: () => <HeaderWithTooltip label="Avg Speed" tooltip="Average speed across all SF2G commutes" />,
    cell: (info) => {
      return <span className="leaderboard__route-count">{info.getValue()}</span>
    },
    size: 96,
  }),
  columnHelper.accessor('avg_tailwind_ms', {
    header: () => <HeaderWithTooltip
      label="Avg Wind"
      tooltip="Average wind assistance across all SF2G rides (mph). Positive (green) = tailwind pushing you forward. Negative (red) = headwind slowing you down. Computed by projecting Open-Meteo historical wind data onto each ride's direction of travel."
    />,
    cell: (info) => {
      const ms = safeNumber(info.getValue())
      const mph = msToMph(ms)
      const absValue = Math.abs(mph)
      if (absValue < 0.2) {
        return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
      }
      const sign = mph > 0 ? '+' : ''
      const color = mph > 0.2
        ? 'var(--color-success)'
        : 'var(--color-error)'
      return (
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
          {sign}{mph.toFixed(1)}
        </span>
      )
    },
    size: 88,
    sortDescFirst: true,
  }),
  columnHelper.accessor('bayway_count', {
    header: () => <HeaderWithTooltip label="Bayway" tooltip="Bayway route rides — flat route via the bay trail (~40 mi). Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'bayway',
        'var(--color-bayway)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor('skyline_count', {
    header: () => <HeaderWithTooltip label="Skyline" tooltip="Skyline route rides — hilly route via CA-35 (~45 mi). Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'skyline',
        'var(--color-skyline)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor('hmbw_count', {
    header: () => <HeaderWithTooltip label="HMBW" tooltip="Half Moon Bay Way rides — coastal scenic route (~50 mi). Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'hmbw',
        'var(--color-hmbw)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor('royale_count', {
    header: () => <HeaderWithTooltip label="Royale" tooltip="Royale route rides — Skyline + HMBW combined (~55 mi). Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'royale',
        'var(--color-royale)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor('fleaway_count', {
    header: () => <HeaderWithTooltip label="Fleaway" tooltip="Fleaway route rides — flat El Camino/Bayshore blend. Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'fleaway',
        'var(--color-fleaway)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor('mebw_count', {
    header: () => <HeaderWithTooltip label="MEBW" tooltip="Middle East Bay Way rides — through Castro Valley and Fremont. Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'mebw',
        'var(--color-mebw)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor('febw_count', {
    header: () => <HeaderWithTooltip label="FEBW" tooltip="Far East Bay Way rides — through Berkeley Hills, Orinda, Dublin. Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'febw',
        'var(--color-febw)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor('other_count', {
    header: () => <HeaderWithTooltip label="Other" tooltip="Unclassified or alternate route rides. Click to see rides." />,
    cell: (info) =>
      routeCountCell(
        info.getValue(),
        info.row.original.user_id,
        info.row.original.display_name,
        'other',
        'var(--color-other)',
        info.table.options.meta,
      ),
    size: 72,
  }),
  columnHelper.accessor(
    (row) => {
      const total = safeNumber(row.total_distance_meters)
      return total > 0 ? safeNumber(row.sf2g_distance_meters) / total : 0
    },
    {
      id: 'sf2g_dist_pct',
      header: () => <HeaderWithTooltip label="% Dist" tooltip="Percentage of total ride distance that is SF2G commuting (sortable)" />,
      cell: (info) => (
        <TinyPie
          sf2gValue={info.row.original.sf2g_distance_meters}
          totalValue={info.row.original.total_distance_meters}
          kind="distance"
        />
      ),
      size: 72,
      sortDescFirst: true,
    },
  ),
  columnHelper.accessor(
    (row) => {
      const total = safeNumber(row.total_elevation_meters)
      return total > 0 ? safeNumber(row.sf2g_elevation_meters) / total : 0
    },
    {
      id: 'sf2g_elev_pct',
      header: () => <HeaderWithTooltip label="% Elev" tooltip="Percentage of total elevation gain that is SF2G commuting (sortable)" />,
      cell: (info) => (
        <TinyPie
          sf2gValue={info.row.original.sf2g_elevation_meters}
          totalValue={info.row.original.total_elevation_meters}
          kind="elevation"
        />
      ),
      size: 72,
      sortDescFirst: true,
    },
  ),
  columnHelper.accessor('sf2g_distance_meters', {
    header: () => <HeaderWithTooltip label="SF2G Dist" tooltip="Total distance from SF2G commute rides only" />,
    cell: (info) => {
      return <span>{info.getValue()}</span>
    },
    size: 96,
  }),
  columnHelper.accessor('sf2g_elevation_meters', {
    header: () => <HeaderWithTooltip label="SF2G Elev" tooltip="Total elevation gain from SF2G commute rides only" />,
    cell: (info) => {
      return <span>{info.getValue()}</span>
    },
    size: 96,
  }),
  columnHelper.accessor('last_ride_date', {
    header: () => <HeaderWithTooltip label="Last SF2G" tooltip="Date of most recent SF2G commute ride (excludes non-SF2G rides)" />,
    cell: (info) => {
      const formatted = formatRideDate(info.getValue())
      if (!formatted) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
      return (
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {formatted}
        </span>
      )
    },
    size: 120,
  }),
]

/** IDs to keep in condensed mode: Rank, Avatar, Rider, SF2G, Avg Speed, Bayway, Skyline, HMBW, Other */
const CONDENSED_COLUMN_IDS = new Set([
  'rank',
  'avatar_url',
  'display_name',
  'sf2g_total',
  'avg_speed_mps',
  'bayway_count',
  'skyline_count',
  'hmbw_count',
  'other_count',
])

export type TableDensity = 'condensed' | 'expanded'

/**
 * Returns column definitions filtered by density, with unit-aware formatting.
 */
export function getLeaderboardColumns(
  unit: UnitSystem,
  density: TableDensity,
) {
  // Apply unit-aware formatting to the base columns
  const columns = leaderboardColumns.map((col) => {
    const id = 'accessorKey' in col ? (col as { accessorKey: string }).accessorKey : col.id
    if (id === 'avg_speed_mps') {
      return {
        ...col,
        cell: (info: { getValue: () => unknown }) => (
          <span className="leaderboard__route-count">{formatSpeed(info.getValue(), unit)}</span>
        ),
      }
    }
    if (id === 'sf2g_distance_meters') {
      return {
        ...col,
        cell: (info: { getValue: () => unknown }) => (
          <span>{formatDistance(info.getValue(), unit)}</span>
        ),
      }
    }
    if (id === 'sf2g_elevation_meters') {
      return {
        ...col,
        cell: (info: { getValue: () => unknown }) => (
          <span>{formatElevation(info.getValue(), unit)}</span>
        ),
      }
    }
    return col
  })

  if (density === 'condensed') {
    return columns.filter(
      (col) => {
        const colId = 'accessorKey' in col ? (col as { accessorKey: string }).accessorKey : col.id
        return CONDENSED_COLUMN_IDS.has(colId ?? '')
      },
    )
  }
  return columns
}
