/**
 * MobileBottomBar — Fixed bottom navigation bar for mobile leaderboard.
 *
 * Two buttons:
 * - 📊 Graph — toggles a full-screen graph overlay
 * - 🔍 Filters — toggles a slide-up filters panel
 *
 * View switching (Riders/Rides/All Time) is handled by the mobile header toggle.
 */

export interface MobileBottomBarProps {
  onToggleGraph: () => void
  onToggleSettings: () => void
  isGraphOpen: boolean
  isSettingsOpen: boolean
}

export function MobileBottomBar({
  onToggleGraph,
  onToggleSettings,
  isGraphOpen,
  isSettingsOpen,
}: MobileBottomBarProps) {
  return (
    <nav className="mobile-bottom-bar" aria-label="Mobile navigation">
      <button
        type="button"
        className={`mobile-bottom-bar__btn${isGraphOpen ? ' mobile-bottom-bar__btn--active' : ''}`}
        onClick={onToggleGraph}
        aria-pressed={isGraphOpen}
        aria-label="Toggle growth chart"
      >
        <span className="mobile-bottom-bar__icon" aria-hidden="true">
          📊
        </span>
        <span className="mobile-bottom-bar__label">Graph</span>
      </button>

      <button
        type="button"
        className={`mobile-bottom-bar__btn${isSettingsOpen ? ' mobile-bottom-bar__btn--active' : ''}`}
        onClick={onToggleSettings}
        aria-pressed={isSettingsOpen}
        aria-label="Toggle filters panel"
      >
        <span className="mobile-bottom-bar__icon" aria-hidden="true">
          🔍
        </span>
        <span className="mobile-bottom-bar__label">Filters</span>
      </button>
    </nav>
  )
}
