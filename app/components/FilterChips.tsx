import { useMemo } from 'react'
import type { RouteCategory, DestinationCompany } from '../lib/database.types'
import { ROUTE_LABELS, ROUTE_COLORS } from '../lib/constants'

// ---------------------------------------------------------------------------
// Route categories in display order
// ---------------------------------------------------------------------------
const ALL_ROUTES: RouteCategory[] = [
  'bayway',
  'skyline',
  'hmbw',
  'royale',
  'fleaway',
  'mebw',
  'febw',
  'other',
]

const COMPANIES: { value: DestinationCompany; label: string }[] = [
  { value: 'google', label: 'Google' },
  { value: 'meta', label: 'Meta' },
  { value: 'apple', label: 'Apple' },
  { value: 'netflix', label: 'Netflix' },
  { value: 'nvidia', label: 'Nvidia' },
  { value: 'stanford', label: 'Stanford' },
  { value: 'tesla', label: 'Tesla' },
]

// ---------------------------------------------------------------------------
// Date preset definitions
// ---------------------------------------------------------------------------
interface DatePresetDef {
  key: string
  label: string
  getRange: () => { from: string; to: string }
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const DATE_PRESETS: DatePresetDef[] = [
  {
    key: 'this-year',
    label: 'This Year',
    getRange: () => {
      const now = new Date()
      return { from: `${now.getFullYear()}-01-01`, to: toISODate(now) }
    },
  },
  {
    key: 'last-6-months',
    label: 'Last 6 Months',
    getRange: () => {
      const now = new Date()
      const from = new Date(now)
      from.setMonth(from.getMonth() - 6)
      return { from: toISODate(from), to: toISODate(now) }
    },
  },
  {
    key: 'last-30-days',
    label: 'Last 30 Days',
    getRange: () => {
      const now = new Date()
      const from = new Date(now)
      from.setDate(from.getDate() - 30)
      return { from: toISODate(from), to: toISODate(now) }
    },
  },
  {
    key: 'last-year',
    label: 'Last Year',
    getRange: () => {
      const lastYear = new Date().getFullYear() - 1
      return { from: `${lastYear}-01-01`, to: `${lastYear}-12-31` }
    },
  },
  {
    key: 'all-time',
    label: 'All Time',
    getRange: () => ({ from: '', to: '' }),
  },
]

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface FilterChipsProps {
  selectedRoutes: RouteCategory[]
  onRoutesChange: (routes: RouteCategory[]) => void
  pprActive: boolean
  onPprChange: (active: boolean) => void
  selectedCompany: DestinationCompany | undefined
  onCompanyChange: (company: DestinationCompany | undefined) => void
  // Date filtering
  dateFrom: string | undefined
  dateTo: string | undefined
  datePreset: string | undefined
  onDateChange: (dateFrom: string | undefined, dateTo: string | undefined, preset: string | undefined) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function FilterChips({
  selectedRoutes,
  onRoutesChange,
  pprActive,
  onPprChange,
  selectedCompany,
  onCompanyChange,
  dateFrom,
  dateTo,
  datePreset,
  onDateChange,
}: FilterChipsProps) {
  // Toggle a route in the multi-select set
  const toggleRoute = (route: RouteCategory) => {
    if (selectedRoutes.includes(route)) {
      onRoutesChange(selectedRoutes.filter((r) => r !== route))
    } else {
      onRoutesChange([...selectedRoutes, route])
    }
  }

  // Toggle a company (single-select — click again to deselect)
  const toggleCompany = (company: DestinationCompany) => {
    onCompanyChange(selectedCompany === company ? undefined : company)
  }

  // Toggle a date preset (single-select — click again to deselect / go to "All Time")
  const toggleDatePreset = (preset: DatePresetDef) => {
    if (preset.key === 'all-time' || datePreset === preset.key) {
      // Clear date filters
      onDateChange(undefined, undefined, undefined)
    } else {
      const range = preset.getRange()
      onDateChange(range.from || undefined, range.to || undefined, preset.key)
    }
  }

  // Custom date input change — clears preset
  const handleCustomDateFrom = (value: string) => {
    onDateChange(value || undefined, dateTo, undefined)
  }

  const handleCustomDateTo = (value: string) => {
    onDateChange(dateFrom, value || undefined, undefined)
  }

  // Memoize max date for inputs
  const maxDate = useMemo(() => toISODate(new Date()), [])

  const handleKeyDown = (
    e: React.KeyboardEvent,
    action: () => void,
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }

  return (
    <div className="filter-chips">
      {/* Route filter chips */}
      <div
        className="filter-chips__group"
        role="group"
        aria-label="Route filters"
      >
        <span className="filter-chips__label">Routes:</span>

        {ALL_ROUTES.map((route) => {
          const isSelected = selectedRoutes.includes(route)
          const color = ROUTE_COLORS[route]
          return (
            <span
              key={route}
              className={`filter-chip${isSelected ? ' filter-chip--selected' : ''}`}
              role="checkbox"
              aria-checked={isSelected}
              tabIndex={0}
              style={
                {
                  '--chip-color': color,
                } as React.CSSProperties
              }
              onClick={() => toggleRoute(route)}
              onKeyDown={(e) => handleKeyDown(e, () => toggleRoute(route))}
            >
              <span
                className="filter-chip__dot"
                style={{ backgroundColor: color }}
              />
              {ROUTE_LABELS[route]}
            </span>
          )
        })}

        {/* PPR @ 6am chip */}
        <span
          className={`filter-chip filter-chip--ppr${pprActive ? ' filter-chip--selected' : ''}`}
          role="switch"
          aria-checked={pprActive}
          aria-label="Filter by 6am PPR departures"
          tabIndex={0}
          onClick={() => onPprChange(!pprActive)}
          onKeyDown={(e) => handleKeyDown(e, () => onPprChange(!pprActive))}
        >
          <span className="filter-chip__emoji" aria-hidden="true">
            🌅
          </span>
          PPR @ 6am
        </span>
      </div>

      {/* Company filter chips */}
      <div
        className="filter-chips__group"
        role="radiogroup"
        aria-label="Company filters"
      >
        <span className="filter-chips__label">Commute End:</span>

        {COMPANIES.map(({ value, label }) => {
          const isSelected = selectedCompany === value
          return (
            <span
              key={value}
              className={`filter-chip filter-chip--company${isSelected ? ' filter-chip--selected' : ''}`}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => toggleCompany(value)}
              onKeyDown={(e) =>
                handleKeyDown(e, () => toggleCompany(value))
              }
            >
              {label}
            </span>
          )
        })}
      </div>

      {/* Date filter chips + custom range */}
      <div
        className="filter-chips__group"
        role="group"
        aria-label="Date filters"
      >
        <span className="filter-chips__label">Date:</span>

        {DATE_PRESETS.map((preset) => {
          const isSelected = preset.key === 'all-time'
            ? !datePreset && !dateFrom && !dateTo
            : datePreset === preset.key
          return (
            <span
              key={preset.key}
              className={`filter-chip filter-chip--company${isSelected ? ' filter-chip--selected' : ''}`}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => toggleDatePreset(preset)}
              onKeyDown={(e) =>
                handleKeyDown(e, () => toggleDatePreset(preset))
              }
            >
              {preset.label}
            </span>
          )
        })}

        <input
          type="date"
          className="filter-chips__date-input"
          value={dateFrom || ''}
          max={dateTo || maxDate}
          onChange={(e) => handleCustomDateFrom(e.target.value)}
          aria-label="Date from"
        />
        <span className="filter-chips__date-sep">to</span>
        <input
          type="date"
          className="filter-chips__date-input"
          value={dateTo || ''}
          min={dateFrom || undefined}
          max={maxDate}
          onChange={(e) => handleCustomDateTo(e.target.value)}
          aria-label="Date to"
        />
      </div>
    </div>
  )
}
