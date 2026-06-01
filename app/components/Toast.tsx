/**
 * Toast notification system powered by Sonner.
 *
 * This module re-exports sonner's `toast` API and provides a `<ToastProvider>`
 * component that renders the `<Toaster>` with SF2G theme integration.
 *
 * Usage:
 *   1. `<ToastProvider>` is rendered once in `__root.tsx`
 *   2. Import `toast` from this module anywhere — no hooks/context needed
 *   3. `toast.success('Rides synced!')` / `toast.error('Sync failed')` / etc.
 *
 * Sonner docs: https://sonner.emilkowal.dev
 */
import { Toaster, toast } from 'sonner'
import { useState, useEffect } from 'react'

/**
 * Hook to track the current data-theme attribute on <html>.
 * Returns 'dark' or 'light' reactively.
 */
function useTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    // Read initial theme
    const html = document.documentElement
    const current = html.getAttribute('data-theme')
    setTheme(current === 'light' ? 'light' : 'dark')

    // Watch for theme changes via MutationObserver
    const observer = new MutationObserver(() => {
      const updated = html.getAttribute('data-theme')
      setTheme(updated === 'light' ? 'light' : 'dark')
    })

    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}

/**
 * ToastProvider — renders the Sonner `<Toaster>` with SF2G styling.
 * Place once in the root layout. No context needed — `toast()` is global.
 */
export function ToastProvider() {
  const theme = useTheme()

  return (
    <Toaster
      position="top-right"
      expand={false}
      richColors
      closeButton
      theme={theme}
      toastOptions={{
        duration: Infinity,
        style: {
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-surface-elevated)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          boxShadow: theme === 'dark'
            ? '0 4px 16px rgba(0, 0, 0, 0.4)'
            : '0 4px 16px rgba(0, 0, 0, 0.1)',
        },
      }}
    />
  )
}

// Re-export toast for convenient imports
export { toast }
