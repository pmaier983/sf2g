import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { triggerSync, triggerFullResync } from "../server/trigger-sync";
import { currentUserQueryOptions } from "../queries/user";
import { toast } from "./Toast";
import { trackError } from "../lib/analytics";
import type { SyncResult } from "../server/sync";

const SESSION_KEY = "sf2g_synced";

/**
 * SyncStatus — sync controls for logged-in users.
 * Full-width banner before sync, compact button after sync.
 */
export function SyncStatus() {
  const { data: user } = useQuery(currentUserQueryOptions());
  const queryClient = useQueryClient();

  const [isSyncing, setIsSyncing] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [hasSyncedThisSession, setHasSyncedThisSession] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [showResyncConfirm, setShowResyncConfirm] = useState(false);

  // Defer rendering until after hydration to avoid SSR/client mismatch.
  // This component depends on sessionStorage + client-resolved user data +
  // locale-dependent date formatting — all of which differ server vs client.
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Check sessionStorage on mount
  useEffect(() => {
    try {
      if (
        typeof window !== "undefined" &&
        sessionStorage.getItem(SESSION_KEY) === "true"
      ) {
        setHasSyncedThisSession(true);
      }
    } catch {
      // sessionStorage may not be available in SSR
    }
  }, []);

  if (!hasMounted || !user) return null;

  const isBusy = isSyncing || isResyncing;

  const handleSyncResult = async (result: SyncResult, isResync: boolean) => {
    setSyncResult(result);

    // Check if sync "succeeded" but had errors (e.g. Strava API issues)
    if (result.errors.length > 0) {
      console.warn("[SyncStatus] Sync completed with errors:", result.errors);
      if (result.totalProcessed === 0) {
        toast.error("Sync failed to fetch rides", {
          description: result.errors[0],
        });
        trackError("sync", result.errors[0], {
          userId: user.id,
          totalProcessed: 0,
        });
      } else {
        // Partial success — some rides imported but there were issues
        toast.warning(`Synced ${result.newRides} rides`, {
          description: `${result.errors.length} error(s) occurred during sync.`,
        });
        trackError("sync", `Partial sync: ${result.errors.length} error(s)`, {
          userId: user.id,
          newRides: result.newRides,
          errorCount: result.errors.length,
        });
      }
    } else if (isResync) {
      toast.success(`Re-synced ${result.newRides} rides with updated data!`);
    } else if (result.newRides > 0) {
      toast.success(`Synced ${result.newRides} new rides!`);
    } else {
      toast.info("Already up to date — no new rides found.");
    }

    // Mark as synced in session
    try {
      sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      // Ignore sessionStorage errors
    }
    setHasSyncedThisSession(true);

    // Invalidate queries to refresh data
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
      queryClient.invalidateQueries({ queryKey: ["rides", user.id] }),
      queryClient.invalidateQueries({ queryKey: ["rides-leaderboard"] }),
    ]);
  };

  const handleSyncError = (err: unknown) => {
    const message = err instanceof Error ? err.message : "Sync failed";

    if (message.startsWith("REAUTH_REQUIRED:")) {
      toast.warning("Strava connection expired", {
        description: message.replace("REAUTH_REQUIRED:", ""),
        duration: Infinity,
      });
      trackError("auth", err, { userId: user.id, type: "reauth_required" });
      // Redirect to login after a short delay
      setTimeout(() => {
        window.location.href = "/auth/login";
      }, 2000);
      return;
    }

    if (message.startsWith("SYNC_COOLDOWN:")) {
      toast.info("Sync cooldown", {
        description: message.replace("SYNC_COOLDOWN:", ""),
      });
      return;
    }

    if (message.startsWith("SYNC_BUSY:")) {
      toast.warning("Server busy", {
        description: message.replace("SYNC_BUSY:", ""),
      });
      return;
    }

    // Handle SYNC_FAILED (Strava outage etc)
    const cleanMessage = message.startsWith("SYNC_FAILED:")
      ? message.replace("SYNC_FAILED:", "")
      : message;

    toast.error("Ride sync failed", {
      description: cleanMessage,
    });
    trackError("sync", err, { userId: user.id });
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);

    try {
      const result = await triggerSync();
      await handleSyncResult(result, false);
    } catch (err) {
      handleSyncError(err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFullResync = async () => {
    setShowResyncConfirm(false);
    setIsResyncing(true);
    setSyncResult(null);

    try {
      const result = await triggerFullResync();
      await handleSyncResult(result, true);
    } catch (err) {
      handleSyncError(err);
    } finally {
      setIsResyncing(false);
    }
  };

  // Compact state — after sync this session
  if (hasSyncedThisSession && !isBusy) {
    return (
      <div className="sync-status sync-status--compact">
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => {
            setHasSyncedThisSession(false);
            try {
              sessionStorage.removeItem(SESSION_KEY);
            } catch {
              /* ignore */
            }
          }}
          aria-label="Show sync options"
        >
          ✓ Synced
          {syncResult && syncResult.newRides > 0 && (
            <span className="sync-status__count">+{syncResult.newRides}</span>
          )}
        </button>
      </div>
    );
  }

  // Banner state — before sync
  return (
    <>
      {/* Re-sync confirmation dialog overlay */}
      {showResyncConfirm && !isBusy && (
        <div
          className="resync-dialog__overlay"
          onClick={() => setShowResyncConfirm(false)}
        >
          <div className="resync-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="resync-dialog__title">⚠️ Re-sync all rides?</h3>
            <ul className="resync-dialog__list">
              <li>🔄 Re-fetches your entire ride history from Strava</li>
              <li>⚡ Updates watts, heart rate, and calories data</li>
              <li>✅ Manual ride overrides will be preserved</li>
              <li>⏱️ This is a heavy operation — may take a minute</li>
            </ul>
            <p className="resync-dialog__note">
              This uses many Strava API calls. Only do this if you need to
              backfill sensor data.
            </p>
            <div className="resync-dialog__actions">
              <button
                id="resync-confirm-btn"
                className="btn btn--primary btn--sm"
                onClick={handleFullResync}
              >
                Yes, Re-sync All
              </button>
              <button
                id="resync-cancel-btn"
                className="btn btn--ghost btn--sm"
                onClick={() => setShowResyncConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sync-status sync-status--banner">
        <div className="sync-status__info">
          <span className="sync-status__text">
            {user.last_sync_at ? (
              <>
                Last sync:{" "}
                <span className="sync-status__time">
                  {new Date(user.last_sync_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </>
            ) : (
              "Rides not yet synced — tap Sync Now to import your ride history."
            )}
          </span>
        </div>
        <div className="sync-status__btn-group">
          <div className="sync-status__btn-row">
            <button
              className="btn btn--primary btn--sm"
              onClick={handleSync}
              disabled={isBusy}
            >
              {isSyncing ? (
                <>
                  <span className="sync-status__spinner" />
                  Syncing...
                </>
              ) : (
                "🔄 Sync Now"
              )}
            </button>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => setShowResyncConfirm(true)}
              disabled={isBusy}
            >
              {isResyncing ? (
                <>
                  <span className="sync-status__spinner" />
                  Re-syncing...
                </>
              ) : (
                "🔃 Re-sync All"
              )}
            </button>
          </div>
          <span className="sync-status__hint">
            {isBusy ? (
              "Check all permission boxes when connecting Strava"
            ) : (
              <>
                No rides?{" "}
                <a href="/auth/login" className="sync-status__hint-link">
                  Reconnect
                </a>{" "}
                with all boxes checked
              </>
            )}
          </span>
        </div>
      </div>
    </>
  );
}
