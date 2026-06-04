/**
 * MobileSettingsPanel — Slide-up drawer from the bottom bar on mobile.
 *
 * Contains ALL filter controls (reuses FilterChips), plus search input,
 * density toggle, and duration selector (for All Time view).
 */
import { FilterChips } from './FilterChips'
import type { FilterChipsProps } from './FilterChips'

export interface MobileSettingsPanelProps extends FilterChipsProps {
  isOpen: boolean
  onClose: () => void
  /** Current search query */
  search: string
  onSearchChange: (value: string) => void
  /** Current view */
  view: 'riders' | 'rides' | 'alltime'
  /** Density for the riders view */
  density: 'condensed' | 'expanded'
  onDensityChange: (density: 'condensed' | 'expanded') => void
  /** Duration for the All Time view */
  duration: string
  onDurationChange: (duration: string) => void
}

const DURATION_PRESETS = [
  { value: '1w', label: '1 Week' },
  { value: '1m', label: '1 Month' },
  { value: '1y', label: '1 Year' },
] as const

export function MobileSettingsPanel({
  isOpen,
  onClose,
  search,
  onSearchChange,
  view,
  density,
  onDensityChange,
  duration,
  onDurationChange,
  // FilterChips props
  ...filterChipsProps
}: MobileSettingsPanelProps) {
  return (
    <>
      {/* Backdrop overlay */}
      {isOpen && (
        <div
          className="mobile-settings-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-up panel */}
      <div
        className={`mobile-settings-panel${isOpen ? ' mobile-settings-panel--open' : ''}`}
        role="dialog"
        aria-label="Leaderboard settings"
        aria-hidden={!isOpen}
      >
        {/* Visual handle bar for swipe affordance */}
        <div className="mobile-settings-panel__handle" aria-hidden="true">
          <div className="mobile-settings-panel__handle-bar" />
        </div>

        <div className="mobile-settings-panel__content">
          {/* Search input */}
          <div className="mobile-settings-panel__section">
            <label
              htmlFor="mobile-settings-search"
              className="mobile-settings-panel__section-label"
            >
              Search
            </label>
            <input
              id="mobile-settings-search"
              type="search"
              className="mobile-settings-panel__search"
              placeholder={
                view === 'rides' ? 'Search rides...' : 'Search riders...'
              }
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          {/* Density toggle — only in riders view */}
          {view === 'riders' && (
            <div className="mobile-settings-panel__section">
              <span className="mobile-settings-panel__section-label">
                Density
              </span>
              <div className="mobile-settings-panel__density-toggle">
                <button
                  type="button"
                  className={`mobile-settings-panel__density-btn${density === 'condensed' ? ' mobile-settings-panel__density-btn--active' : ''}`}
                  onClick={() => onDensityChange('condensed')}
                  aria-pressed={density === 'condensed'}
                >
                  ≡ Condensed
                </button>
                <button
                  type="button"
                  className={`mobile-settings-panel__density-btn${density === 'expanded' ? ' mobile-settings-panel__density-btn--active' : ''}`}
                  onClick={() => onDensityChange('expanded')}
                  aria-pressed={density === 'expanded'}
                >
                  ⊞ Expanded
                </button>
              </div>
            </div>
          )}

          {/* Duration selector — only in alltime view */}
          {view === 'alltime' && (
            <div className="mobile-settings-panel__section">
              <span className="mobile-settings-panel__section-label">
                Duration
              </span>
              <div className="mobile-settings-panel__duration-toggle">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`mobile-settings-panel__duration-btn${duration === preset.value ? ' mobile-settings-panel__duration-btn--active' : ''}`}
                    onClick={() => onDurationChange(preset.value)}
                    aria-pressed={duration === preset.value}
                  >
                    {preset.label}
                  </button>
                ))}
                <input
                  type="number"
                  className="mobile-settings-panel__duration-input"
                  min={1}
                  max={3650}
                  placeholder="days"
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (val > 0 && val <= 3650) {
                      onDurationChange(`${val}d`)
                    }
                  }}
                  aria-label="Custom duration in days"
                />
              </div>
            </div>
          )}

          {/* Filter chips — all filters */}
          <div className="mobile-settings-panel__section">
            <span className="mobile-settings-panel__section-label">
              Filters
            </span>
            <FilterChips {...filterChipsProps} />
          </div>
        </div>
      </div>
    </>
  )
}
