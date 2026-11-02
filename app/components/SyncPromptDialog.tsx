/**
 * SyncPromptDialog — first-visit dialog prompting users to connect Strava.
 *
 * Shows once per device (tracked via localStorage). Only appears for
 * users who are NOT logged in, and never on public reference pages
 * (SYNC_PROMPT_EXEMPT_PATHS) that people open from a shared link to read.
 * Uses the same native <dialog> pattern as EditRideDialog for visual
 * consistency.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { currentUserQueryOptions } from "../queries/user";
import { StravaLoginButton } from "./StravaLoginButton";

const DISMISSED_KEY = "sf2g-sync-prompt-dismissed";

/** Pages that never ask visitors to connect Strava. */
const SYNC_PROMPT_EXEMPT_PATHS = ["/races"];

export function isSyncPromptExemptPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return SYNC_PROMPT_EXEMPT_PATHS.includes(path);
}

export function SyncPromptDialog() {
  const { data: user, isLoading } = useQuery(currentUserQueryOptions());
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const exempt = isSyncPromptExemptPath(pathname);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // Defer to after hydration — localStorage is client-only
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Decide whether to show the dialog after hydration + user query settles
  useEffect(() => {
    if (!hasMounted || isLoading) return;
    // Already logged in — never show
    if (user) return;
    // Public reference page: let people read. The prompt can still appear
    // later on a leaderboard page (nothing is marked dismissed here).
    if (exempt) {
      setIsOpen(false);
      return;
    }

    try {
      if (localStorage.getItem(DISMISSED_KEY) === "true") return;
    } catch {
      // localStorage unavailable — don't show
      return;
    }

    setIsOpen(true);
  }, [hasMounted, isLoading, user, exempt]);

  // Native dialog open/close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Listen for DevTools trigger to force-show the dialog
  useEffect(() => {
    const handleShowEvent = () => setIsOpen(true);
    window.addEventListener("sf2g:show-sync-prompt", handleShowEvent);
    return () =>
      window.removeEventListener("sf2g:show-sync-prompt", handleShowEvent);
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Ignore storage errors
    }
    setIsOpen(false);
  }, []);

  // Close on backdrop click
  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        handleDismiss();
      }
    },
    [handleDismiss],
  );

  // Close on Escape
  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      handleDismiss();
    },
    [handleDismiss],
  );

  // Don't render anything server-side or while loading
  if (!hasMounted || isLoading) return null;
  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="edit-ride-dialog__backdrop"
      onClick={handleDialogClick}
      onCancel={handleCancel}
      aria-label="Connect with Strava"
    >
      <div className="edit-ride-dialog__content sync-prompt-dialog">
        {/* Header */}
        <div className="edit-ride-dialog__header">
          <h2 className="edit-ride-dialog__title">Welcome to SF2G! 🚴</h2>
          <button
            className="edit-ride-dialog__close"
            onClick={handleDismiss}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="sync-prompt-dialog__body">
          <p className="sync-prompt-dialog__description">
            Connect your Strava account to automatically sync your rides and
            appear on the leaderboard.
          </p>

          <div className="sync-prompt-dialog__features">
            <div className="sync-prompt-dialog__feature">
              <span className="sync-prompt-dialog__feature-icon">📊</span>
              <span>Track your SF2G commute stats</span>
            </div>
            <div className="sync-prompt-dialog__feature">
              <span className="sync-prompt-dialog__feature-icon">🏆</span>
              <span>Compete on the leaderboard</span>
            </div>
            <div className="sync-prompt-dialog__feature">
              <span className="sync-prompt-dialog__feature-icon">🗺️</span>
              <span>Auto-classify routes (Bayway, Skyline, etc.)</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="edit-ride-dialog__actions sync-prompt-dialog__actions">
          <button
            type="button"
            className="btn btn--ghost sync-prompt-dialog__dismiss-btn"
            onClick={handleDismiss}
          >
            No, I don&apos;t want to be on the leaderboard
          </button>
          <StravaLoginButton large />
        </div>
      </div>
    </dialog>
  );
}
