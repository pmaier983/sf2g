import { Link } from '@tanstack/react-router'

/**
 * StravaLoginButton — "Connect with Strava" CTA.
 * Uses the official Strava button asset per Brand Guidelines:
 * https://developers.strava.com/guidelines/
 *
 * Links to /auth/login which triggers the OAuth flow.
 */
export function StravaLoginButton({ large }: { large?: boolean }) {
  return (
    <Link
      to="/auth/login"
      className={`strava-btn${large ? ' strava-btn--lg' : ''}`}
    >
      <img
        src="/connect-with-strava-orange.svg"
        alt="Connect with Strava"
        className="strava-btn__img"
      />
    </Link>
  )
}
