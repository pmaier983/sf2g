import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  currentUserQueryOptions,
  mySyncStateQueryOptions,
} from "../queries/user";

/**
 * Shown to a signed-in rider whose Strava refresh token was rejected: their
 * rides stop syncing until they reconnect. Set by the sync queue drain
 * (users.needs_reauth), cleared by the OAuth callback.
 */
export function ReconnectBanner() {
  const { data: user } = useQuery(currentUserQueryOptions());
  const { data: state } = useQuery({
    ...mySyncStateQueryOptions(),
    enabled: !!user,
  });

  if (!user || !state?.needsReauth) return null;

  return (
    <div className="reconnect-banner" role="alert">
      <span>Your Strava connection expired, so new rides aren't syncing.</span>
      <Link
        to="/auth/login"
        search={{ force: true }}
        className="btn btn--primary btn--sm"
      >
        Reconnect Strava
      </Link>
    </div>
  );
}
