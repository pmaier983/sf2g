import { useState, useEffect } from 'react'

/**
 * UnitToggle — toggles between kilometers and miles.
 * Persists preference in localStorage. Dispatches a custom event
 * so other components can react to the change.
 */

export type UnitSystem = 'mi' | 'km'

const STORAGE_KEY = 'sf2g-units'

/** Read the current unit preference (safe for SSR) */
export function getStoredUnit(): UnitSystem {
  if (typeof window === 'undefined') return 'mi'
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'km') return 'km'
  } catch {
    /* noop */
  }
  return 'mi'
}

/** Convert meters to the display unit */
export function formatDistance(meters: number, unit: UnitSystem): string {
  if (unit === 'km') {
    return `${(meters / 1000).toFixed(1)} km`
  }
  return `${(meters / 1609.344).toFixed(1)} mi`
}

/** Convert m/s to display speed */
export function formatSpeed(metersPerSec: number, unit: UnitSystem): string {
  if (unit === 'km') {
    return `${(metersPerSec * 3.6).toFixed(1)} km/h`
  }
  return `${(metersPerSec * 2.23694).toFixed(1)} mph`
}

export function UnitToggle() {
  // Always initialize as 'mi' to match SSR output and avoid hydration mismatch.
  // The real value is synced from localStorage in useEffect after hydration.
  const [unit, setUnit] = useState<UnitSystem>('mi')

  useEffect(() => {
    // After hydration, sync state with the stored preference
    setUnit(getStoredUnit())
  }, [])

  const selectUnit = (next: UnitSystem) => {
    if (next === unit) return
    setUnit(next)
    localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent('sf2g-unit-change', { detail: next }))
  }

  return (
    <div
      className="unit-toggle"
      role="radiogroup"
      aria-label="Distance unit"
    >
      <button
        className={`unit-toggle__option${unit === 'mi' ? ' unit-toggle__option--active' : ''}`}
        onClick={() => selectUnit('mi')}
        role="radio"
        aria-checked={unit === 'mi'}
        aria-label="Miles"
      >
        MI
      </button>
      <button
        className={`unit-toggle__option${unit === 'km' ? ' unit-toggle__option--active' : ''}`}
        onClick={() => selectUnit('km')}
        role="radio"
        aria-checked={unit === 'km'}
        aria-label="Kilometers"
      >
        KM
      </button>
    </div>
  )
}
