import { useMemo } from 'react'
import type { RouteCategory, DestinationCompany } from '../lib/database.types'
import { ROUTE_LABELS, ROUTE_COLORS } from '../lib/constants'
import { Tooltip } from './Tooltip'

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
]

/** Routes including 'other' — only shown when the Other toggle is enabled */
const ALL_ROUTES_WITH_OTHER: RouteCategory[] = [...ALL_ROUTES, 'other']

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
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const DATE_PRESETS: DatePresetDef[] = [
  {
    key: 'today',
    label: 'Today',
    getRange: () => {
      const today = toISODate(new Date())
      return { from: today, to: today }
    },
  },
  {
    key: 'this-week',
    label: 'This Week',
    getRange: () => {
      const now = new Date()
      const day = now.getDay()
      // Monday = start of week (getDay(): 0=Sun,1=Mon,...)
      const diffToMonday = day === 0 ? 6 : day - 1
      const monday = new Date(now)
      monday.setDate(monday.getDate() - diffToMonday)
      const sunday = new Date(monday)
      sunday.setDate(sunday.getDate() + 6)
      return { from: toISODate(monday), to: toISODate(sunday) }
    },
  },
  {
    key: 'this-month',
    label: 'This Month',
    getRange: () => {
      const now = new Date()
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      return { from, to: toISODate(now) }
    },
  },
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
// Duration presets for All Time view
// ---------------------------------------------------------------------------
const DURATION_PRESETS = [
  { value: '1w', label: '1 Week' },
  { value: '1m', label: '1 Month' },
  { value: '1y', label: '1 Year' },
] as const

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface FilterChipsProps {
  selectedRoutes: RouteCategory[]
  onRoutesChange: (routes: RouteCategory[]) => void
  pprActive: boolean
  onPprChange: (active: boolean) => void
  weekendsActive: boolean
  onWeekendsChange: (active: boolean) => void
  includeOther: boolean
  onOtherChange: (active: boolean) => void
  selectedCompany: DestinationCompany | undefined
  onCompanyChange: (company: DestinationCompany | undefined) => void
  // Date filtering
  dateFrom: string | undefined
  dateTo: string | undefined
  datePreset: string | undefined
  onDateChange: (dateFrom: string | undefined, dateTo: string | undefined, preset: string | undefined) => void
  // View & duration (for All Time view)
  view: 'riders' | 'rides' | 'alltime'
  duration: string
  onDurationChange: (duration: string) => void
  // Clear all filters
  hasActiveFilters: boolean
  onClearAll: () => void
  /** Prefix for form element IDs to avoid duplicates when rendered in multiple places */
  idPrefix?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function FilterChips({
  selectedRoutes,
  onRoutesChange,
  pprActive,
  onPprChange,
  weekendsActive,
  onWeekendsChange,
  includeOther,
  onOtherChange,
  selectedCompany,
  onCompanyChange,
  dateFrom,
  dateTo,
  datePreset,
  onDateChange,
  view,
  duration,
  onDurationChange,
  hasActiveFilters,
  onClearAll,
  idPrefix = '',
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
      {/* ---- TIME section ---- */}
      <div className="filter-section">
        <span className="filter-section__label">Time</span>
        <div
          className="filter-chips__group"
          role="group"
          aria-label={view === 'alltime' ? 'Duration filters' : 'Date filters'}
        >
          {view === 'alltime' ? (
            /* All Time view: show duration presets instead of date chips */
            DURATION_PRESETS.map((preset) => {
              const isSelected = duration === preset.value
              return (
                <span
                  key={preset.value}
                  className={`filter-chip filter-chip--company${isSelected ? ' filter-chip--selected' : ''}`}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onClick={() => onDurationChange(preset.value)}
                  onKeyDown={(e) =>
                    handleKeyDown(e, () => onDurationChange(preset.value))
                  }
                >
                  {preset.label}
                </span>
              )
            })
          ) : (
            /* Riders / Rides view: show date presets + custom date inputs */
            <>
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
                id={`${idPrefix}filter-date-from`}
                type="date"
                className="filter-chips__date-input"
                value={dateFrom || ''}
                max={dateTo || maxDate}
                onChange={(e) => handleCustomDateFrom(e.target.value)}
                aria-label="Date from"
                suppressHydrationWarning
              />
              <span className="filter-chips__date-sep">to</span>
              <input
                id={`${idPrefix}filter-date-to`}
                type="date"
                className="filter-chips__date-input"
                value={dateTo || ''}
                min={dateFrom || undefined}
                max={maxDate}
                onChange={(e) => handleCustomDateTo(e.target.value)}
                aria-label="Date to"
                suppressHydrationWarning
              />
            </>
          )}
        </div>
      </div>

      {/* ---- ROUTES section ---- */}
      <div className="filter-section">
        <span className="filter-section__label">Routes</span>
        <div
          className="filter-chips__group"
          role="group"
          aria-label="Route filters"
        >
          {(includeOther ? ALL_ROUTES_WITH_OTHER : ALL_ROUTES).map((route) => {
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
        </div>
      </div>

      {/* ---- OPTIONS section ---- */}
      <div className="filter-section">
        <span className="filter-section__label">Options</span>
        <div
          className="filter-chips__group"
          role="group"
          aria-label="Option filters"
        >
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

          {/* Weekends toggle chip */}
          <Tooltip
            content="Include rides from Saturday and Sunday"
            placement="bottom"
          >
            <span
              className={`filter-chip filter-chip--company${weekendsActive ? ' filter-chip--selected' : ''}`}
              role="switch"
              aria-checked={weekendsActive}
              aria-label="Include weekend rides"
              tabIndex={0}
              onClick={() => onWeekendsChange(!weekendsActive)}
              onKeyDown={(e) => handleKeyDown(e, () => onWeekendsChange(!weekendsActive))}
            >
              <span className="filter-chip__emoji" aria-hidden="true">
                📅
              </span>
              Weekends
            </span>
          </Tooltip>

          {/* Other toggle chip */}
          <Tooltip
            content="When on, rides that don't match any SF2G route corridor are included in totals, charts, and tables. When off, only classified SF2G commutes are counted."
            placement="bottom"
          >
            <span
              className={`filter-chip filter-chip--company${includeOther ? ' filter-chip--selected' : ''}`}
              role="switch"
              aria-checked={includeOther}
              aria-label="Include other rides"
              tabIndex={0}
              onClick={() => onOtherChange(!includeOther)}
              onKeyDown={(e) => handleKeyDown(e, () => onOtherChange(!includeOther))}
            >
              Other
              <span className="filter-chip__info-icon" aria-hidden="true">ⓘ</span>
            </span>
          </Tooltip>

          {/* Company dropdown */}
          <div
            className="filter-chips__company-group"
            role="radiogroup"
            aria-label="Company filters"
          >
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
        </div>
      </div>
    </div>
  )
}
