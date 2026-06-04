/**
 * MobileBottomBar — Fixed bottom navigation bar for mobile leaderboard.
 *
 * Three buttons:
 * - 📊 Graph — toggles a full-screen graph overlay
 * - ⚙️ Settings — toggles a slide-up settings panel
 * - 👤/🚴/🏆 Toggle — cycles through Riders → Rides → All Time
 */

export interface MobileBottomBarProps {
  view: 'riders' | 'rides' | 'alltime'
  onViewChange: (view: 'riders' | 'rides' | 'alltime') => void
  onToggleGraph: () => void
  onToggleSettings: () => void
  isGraphOpen: boolean
  isSettingsOpen: boolean
}

const VIEW_CYCLE: Array<'riders' | 'rides' | 'alltime'> = [
  'riders',
  'rides',
  'alltime',
]

const VIEW_ICONS: Record<string, string> = {
  riders: '👤',
  rides: '🚴',
  alltime: '🏆',
}

const VIEW_LABELS: Record<string, string> = {
  riders: 'Riders',
  rides: 'Rides',
  alltime: 'All Time',
}

export function MobileBottomBar({
  view,
  onViewChange,
  onToggleGraph,
  onToggleSettings,
  isGraphOpen,
  isSettingsOpen,
}: MobileBottomBarProps) {
  const handleCycleView = () => {
    const currentIndex = VIEW_CYCLE.indexOf(view)
    const nextIndex = (currentIndex + 1) % VIEW_CYCLE.length
    onViewChange(VIEW_CYCLE[nextIndex])
  }

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
        aria-label="Toggle settings panel"
      >
        <span className="mobile-bottom-bar__icon" aria-hidden="true">
          ⚙️
        </span>
        <span className="mobile-bottom-bar__label">Settings</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-bar__btn mobile-bottom-bar__btn--view"
        onClick={handleCycleView}
        aria-label={`Switch view (currently ${VIEW_LABELS[view]})`}
      >
        <span className="mobile-bottom-bar__icon" aria-hidden="true">
          {VIEW_ICONS[view]}
        </span>
        <span className="mobile-bottom-bar__label">{VIEW_LABELS[view]}</span>
      </button>
    </nav>
  )
}
