import { useSyncExternalStore } from 'react'
import type { UnitSystem } from '../components/UnitToggle'
import { getStoredUnit } from '../components/UnitToggle'

function subscribe(callback: () => void): () => void {
  const handler = () => callback()
  window.addEventListener('sf2g-unit-change', handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener('sf2g-unit-change', handler)
    window.removeEventListener('storage', handler)
  }
}

function getSnapshot(): UnitSystem {
  return getStoredUnit()
}

function getServerSnapshot(): UnitSystem {
  return 'mi'
}

/** Reactive hook: returns the current unit system ('mi' | 'km') */
export function useUnit(): UnitSystem {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
