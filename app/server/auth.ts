/**
 * Auth server functions.
 *
 * - `getStravaAuthUrl` — returns Strava OAuth authorization URL
 * - `handleStravaCallback` — exchanges code, upserts user, sets session
 * - `getCurrentUser` — reads session, returns user from DB
 * - `logout` — clears session cookie
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient, createServiceClient } from "../lib/supabase";
import {
  getAuthorizationUrl,
  exchangeCode,
  revokeToken,
  ensureValidToken,
} from "../lib/strava-oauth";
import {
  getSessionData,
  setSessionData,
  clearSessionData,
} from "../lib/session";
import { getMissingScopes } from "../lib/constants";
import { PUBLIC_USER_COLUMNS, type PublicUser } from "../lib/public-user";

/** Activities imported inline during the OAuth callback (one Strava page). */
const INITIAL_IMPORT_PER_PAGE = 100;

// ---------------------------------------------------------------------------
// getStravaAuthUrl — returns the Strava OAuth authorize URL
// ---------------------------------------------------------------------------
export const getStravaAuthUrl = createServerFn({ method: "GET" })
  .inputValidator((input: { forceConsent?: boolean }) => input)
  .handler(async ({ data }) => {
    return getAuthorizationUrl(data.forceConsent ?? false);
  });

// ---------------------------------------------------------------------------
// handleStravaCallback — exchanges code for tokens, upserts user, sets session
// ---------------------------------------------------------------------------
export const handleStravaCallback = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { code: string; scope: string; state: string }) => input,
  )
  .handler(async ({ data }) => {
    // 1. Exchange authorization code for tokens
    const tokenData = await exchangeCode(data.code);

    // 2. Validate that the user granted ALL required scopes
    //    Strava lets users uncheck permissions on the consent screen.
    //    If they uncheck "View data about your private activities", the API
    //    silently returns only public rides, causing empty syncs.
    const missingScopes = getMissingScopes(data.scope);
    if (missingScopes.length > 0) {
      console.error(
        `[auth] User denied required scopes: ${missingScopes.join(", ")}. Granted: ${data.scope}`,
      );
      throw new Error(
        `INSUFFICIENT_SCOPES:SF2G needs all permissions checked on the Strava authorization page to work correctly. ` +
          `Please try again and make sure all checkboxes are checked. ` +
          `(Missing: ${missingScopes.join(", ")})`,
      );
    }

    // 3. Upsert user in database (service role client bypasses RLS)
    const supabase = createServiceClient();
    const { data: user, error } = await supabase
      .from("users")
      .upsert(
        {
          strava_id: tokenData.athlete.id,
          username: tokenData.athlete.username,
          first_name: tokenData.athlete.firstname,
          last_name: tokenData.athlete.lastname,
          avatar_url: tokenData.athlete.profile,
          strava_access_token: tokenData.access_token,
          strava_refresh_token: tokenData.refresh_token,
          strava_token_expires_at: new Date(
            tokenData.expires_at * 1000,
          ).toISOString(),
          strava_scopes: data.scope,
          // Reconnecting fixes a rejected refresh token.
          needs_reauth: false,
          deauthorized_at: null,
        },
        { onConflict: "strava_id" },
      )
      .select("*")
      .single();

    if (error || !user) {
      throw new Error(
        `Failed to upsert user: ${error?.message ?? "unknown error"}`,
      );
    }

    // 4. Set session cookie
    await setSessionData({ userId: user.id, stravaId: user.strava_id });

    // 5. Import the newest page of rides inline so the rider sees them right
    //    away, then queue the rest of their history: the sync queue drain
    //    pages backwards one page per tick (app/server/sync-drain.ts). A full
    //    history import inside this request used to exceed the Worker's
    //    subrequest limit and leave riders with truncated histories.
    let syncResult: {
      newRides: number;
      totalProcessed: number;
      errors: string[];
    } | null = null;
    let syncError: string | null = null;

    try {
      const { backfillStep } = await import("./sync");
      const step = await backfillStep(
        user.id,
        Math.floor(Date.now() / 1000),
        INITIAL_IMPORT_PER_PAGE,
      );
      syncResult = {
        newRides: step.upserted,
        totalProcessed: step.upserted,
        errors: [],
      };
      if (step.nextBefore !== null) {
        await supabase.rpc("enqueue_sync_job", {
          p_kind: "backfill",
          p_user_id: user.id,
          p_cursor: { before: step.nextBefore },
        });
      }
      await supabase.rpc("enqueue_sync_job", { p_kind: "refresh_views" });
      console.log(
        `[auth] Initial import for ${user.id}: ${step.upserted} rides${step.nextBefore !== null ? ", backfill queued" : ""}`,
      );
    } catch (err) {
      // Don't block auth on sync failure — the queue retries it.
      // But propagate rate limit errors so the callback page can show them.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auth] Initial import failed (non-blocking): ${message}`);
      syncError = message;
      await supabase
        .rpc("enqueue_sync_job", {
          p_kind: "backfill",
          p_user_id: user.id,
          p_cursor: { before: Math.floor(Date.now() / 1000) },
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }

    // 6. Return redirect URL with sync result metadata
    return {
      redirectTo: "/leaderboard" as const,
      syncResult,
      syncError,
    };
  });

// ---------------------------------------------------------------------------
// getCurrentUser — reads session cookie and returns the user from DB
// ---------------------------------------------------------------------------
export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicUser | null> => {
    const session = await getSessionData();
    if (!session) return null;

    const supabase = createAnonClient();
    const { data: user, error } = await supabase
      .from("users")
      .select(PUBLIC_USER_COLUMNS)
      .eq("id", session.userId)
      .single();

    if (error || !user) return null;

    return user;
  },
);

// ---------------------------------------------------------------------------
// logout — clears session cookie and returns redirect
// ---------------------------------------------------------------------------
export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await clearSessionData();
  return { redirectTo: "/" as const };
});

// ---------------------------------------------------------------------------
// cleanupDeauthorizedUser — shared cleanup for disconnect + webhook deauth
// ---------------------------------------------------------------------------

/**
 * Clean up a user's data after deauthorization.
 *
 * Called by both:
 * - User-initiated disconnect (`disconnectStrava`)
 * - Strava webhook deauth events (`handleAthleteDeauth` in webhook.ts)
 *
 * Does NOT revoke the Strava token — the caller handles that if needed.
 * Does NOT clear the session — the caller handles that if needed.
 */
export async function cleanupDeauthorizedUser(
  userId: string,
): Promise<{ deletedRides: number }> {
  const supabase = createServiceClient();

  // 1. Clear Strava tokens and sync timestamps from the database
  //    Resetting last_activity_at and last_sync_at ensures a clean initial
  //    sync if the user reconnects later (no stale 'after' parameter).
  const { error: updateError } = await supabase
    .from("users")
    .update({
      strava_access_token: "",
      strava_refresh_token: "",
      strava_token_expires_at: new Date(0).toISOString(),
      strava_scopes: "",
      last_activity_at: null,
      last_sync_at: null,
    })
    .eq("id", userId);

  if (updateError) {
    throw new Error(`Failed to clear Strava tokens: ${updateError.message}`);
  }

  // 2. Delete all user rides (Strava API compliance — data must be removed on disconnect)
  const { error: deleteError, count: deletedCount } = await supabase
    .from("rides")
    .delete({ count: "exact" })
    .eq("user_id", userId);

  if (deleteError) {
    console.error(
      `[auth] Failed to delete rides for user ${userId}:`,
      deleteError.message,
    );
    // Don't throw — continue with disconnect even if ride deletion fails
    // The user's tokens are already cleared, so they can't re-sync
  } else {
    console.log(`[auth] Deleted ${deletedCount ?? 0} rides for user ${userId}`);
  }

  // 3. Leaderboards read `rides` directly; queue the group-ride refresh so
  //    the rider also disappears from group rides and the network.
  const { error: enqueueError } = await supabase.rpc("enqueue_sync_job", {
    p_kind: "refresh_views",
  });
  if (enqueueError) {
    console.error(
      "[auth] Failed to queue refresh after ride deletion:",
      enqueueError.message,
    );
  }

  return { deletedRides: deletedCount ?? 0 };
}

// ---------------------------------------------------------------------------
// disconnectStrava — revokes Strava access, cleans up data, clears session
// ---------------------------------------------------------------------------
export const disconnectStrava = createServerFn({ method: "POST" }).handler(
  async () => {
    // 1. Verify the user is authenticated
    const session = await getSessionData();
    if (!session) {
      throw new Error("Not authenticated");
    }

    // 2. Get a valid access token to revoke
    try {
      const accessToken = await ensureValidToken(session.userId);

      // 3. Revoke the token with Strava (best-effort — continue even if it fails)
      try {
        await revokeToken(accessToken);
      } catch (err) {
        // Log but don't block — the user still wants to disconnect locally
        console.error(
          "Failed to revoke Strava token, continuing with local cleanup",
          err,
        );
      }
    } catch (err) {
      // Token might already be invalid — continue with local cleanup
      console.error(
        "Failed to get valid token for revocation, continuing with local cleanup",
        err,
      );
    }

    // 4. Clean up user data (tokens, rides, leaderboard)
    await cleanupDeauthorizedUser(session.userId);

    // 5. Clear session cookie
    await clearSessionData();

    return { redirectTo: "/" as const };
  },
);

// ---------------------------------------------------------------------------
// getMySyncState — the signed-in rider's own sync health (never another's)
// ---------------------------------------------------------------------------
export interface MySyncState {
  needsReauth: boolean;
  /** Queued or running sync jobs (history import in progress). */
  pendingJobs: number;
}

export const getMySyncState = createServerFn({ method: "GET" }).handler(
  async (): Promise<MySyncState | null> => {
    const session = await getSessionData();
    if (!session) return null;
    const { data } = await createServiceClient()
      .from("sync_health")
      .select("needs_reauth, open_jobs")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!data) return null;
    return {
      needsReauth: data.needs_reauth ?? false,
      pendingJobs: Number(data.open_jobs ?? 0),
    };
  },
);
