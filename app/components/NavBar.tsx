import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useCallback, useEffect } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { UnitToggle } from './UnitToggle'
import { StravaLoginButton } from './StravaLoginButton'
import { currentUserQueryOptions } from '../queries/user'
import { logout } from '../server/auth'

/**
 * NavBar — dark charcoal navigation bar with SF2G logo, nav links,
 * unit/theme toggles, hamburger menu for mobile, and a sub-bar
 * linking to the original sf2g.com.
 */
export function NavBar() {
  const { data: user } = useQuery(currentUserQueryOptions())
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    const result = await logout()
    if (result.redirectTo) {
      window.location.href = result.redirectTo
    }
  }

  const handleFeedback = () => {
    const url = new URL('https://github.com/pmaier983/sf2g/issues/new')
    url.searchParams.set('title', '[Feedback] ')
    url.searchParams.set('labels', 'feedback')
    url.searchParams.set('body', [
      '## Feedback\n',
      '_Please describe your feedback, bug, or feature request here._\n',
      '---',
      '### Context (auto-filled)',
      `- **Page:** ${window.location.href}`,
      `- **Time:** ${new Date().toISOString()}`,
      `- **Theme:** ${document.documentElement.getAttribute('data-theme')}`,
      `- **Screen:** ${window.innerWidth}×${window.innerHeight}`,
      '',
      '> 💡 Tip: You can paste screenshots directly into this issue!',
    ].join('\n'))
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen((prev) => !prev)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [currentPath])

  const navLinks = [
    { to: '/' as const, label: 'Home' },
    { to: '/routes' as const, label: 'Routes' },
  ]

  return (
    <>
      <nav className="navbar" id="main-nav">
        <div className="navbar__inner">
          {/* Brand */}
          <Link to="/" className="navbar__brand">
            <span className="navbar__brand-icon">🚴</span>
            <span className="navbar__brand-text">SF2G</span>
          </Link>
          <span className="navbar__tagline">
            A leaderboard for the{' '}
            <a
              href="https://sf2g.com"
              target="_blank"
              rel="noopener noreferrer"
              className="navbar__tagline-link"
            >
              sf2g.com
            </a>
            {' '}community
          </span>

          {/* Navigation Links (desktop) */}
          <div className="navbar__links">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className={`navbar__link${
                  currentPath === link.to ? ' navbar__link--active' : ''
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Actions (desktop) */}
          <div className="navbar__actions">
            <UnitToggle />
            <ThemeToggle />
            <button
              className="navbar__feedback-btn"
              onClick={handleFeedback}
              title="Send Feedback"
              aria-label="Send feedback"
            >
              💬
            </button>

            {user ? (
              <div className="navbar__user-group">
                <Link to="/profile/$userId" params={{ userId: user.id }}>
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.display_name ?? 'User'}
                      className="navbar__avatar"
                    />
                  ) : (
                    <div className="navbar__avatar navbar__avatar--placeholder">
                      👤
                    </div>
                  )}
                </Link>
                <button
                  className="btn btn--ghost btn--sm navbar__logout-btn"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            ) : (
              <StravaLoginButton />
            )}
          </div>

          {/* Hamburger button (mobile only) */}
          <button
            className={`navbar__hamburger${isMobileMenuOpen ? ' navbar__hamburger--open' : ''}`}
            type="button"
            onClick={toggleMobileMenu}
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileMenuOpen}
          >
            <span className="navbar__hamburger-line" />
            <span className="navbar__hamburger-line" />
            <span className="navbar__hamburger-line" />
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {isMobileMenuOpen && (
          <div className="navbar__mobile-menu">
            <div className="navbar__mobile-links">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  to={link.to}
                  className={`navbar__mobile-link${
                    currentPath === link.to ? ' navbar__mobile-link--active' : ''
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <button
                className="navbar__mobile-link"
                onClick={handleFeedback}
              >
                💬 Feedback
              </button>
            </div>
            <div className="navbar__mobile-actions">
              <div className="navbar__mobile-toggles">
                <UnitToggle />
                <ThemeToggle />
              </div>
              {user ? (
                <div className="navbar__mobile-user">
                  <Link
                    to="/profile/$userId"
                    params={{ userId: user.id }}
                    className="navbar__mobile-link"
                  >
                    👤 My Profile
                  </Link>
                  <button
                    className="btn btn--ghost btn--sm navbar__logout-btn"
                    onClick={handleLogout}
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <StravaLoginButton />
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  )
}
