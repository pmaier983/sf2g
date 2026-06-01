import { useState, useEffect } from 'react'

/**
 * ThemeToggle — toggles between dark and light mode.
 * Persists preference in localStorage. Sets `data-theme` on <html>.
 * Dark mode is the default.
 */
export function ThemeToggle() {
  // Always initialize as 'dark' to match SSR output and avoid hydration mismatch.
  // The blocking <head> script sets the correct data-theme on <html> before paint,
  // but React state must match the server-rendered value during hydration.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    // After hydration, sync state with the actual DOM value
    // (which was set by the blocking script in <head>)
    const current = document.documentElement.getAttribute('data-theme')
    if (current === 'light' || current === 'dark') {
      setTheme(current)
    }
  }, [])

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('sf2g-theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? '🌙' : '☀️'}
    </button>
  )
}
