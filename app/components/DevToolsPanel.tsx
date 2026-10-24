import { useState } from "react";
import { triggerReclassify, type ReclassifyResult } from "../server/reclassify";
import type { CronResult } from "../server/cron";
import type { SyncHealth } from "../server/users";
import type { SegmentIngestStats } from "../server/segments-admin";

/**
 * DevToolsPanel — floating dev tools panel with a button to
 * reclassify all rides in the database.
 *
 * Only rendered when VITE_APP_URL contains 'localhost' (dev mode).
 */
export function DevToolsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ReclassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cron jobs state
  const [cronIsRunning, setCronIsRunning] = useState(false);
  const [cronResult, setCronResult] = useState<CronResult | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);

  // Sync health state
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Segment ingest state
  const [segmentLimit, setSegmentLimit] = useState(500);
  const [segmentStats, setSegmentStats] = useState<SegmentIngestStats | null>(
    null,
  );
  const [segmentEnqueued, setSegmentEnqueued] = useState<number | null>(null);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);

  const handleReclassify = async () => {
    setIsRunning(true);
    setResult(null);
    setError(null);

    try {
      const res = await triggerReclassify();
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleSyncHealth = async () => {
    setHealthLoading(true);
    try {
      const { fetchSyncHealth } = await import("../server/users");
      setHealth(await fetchSyncHealth());
    } catch (err) {
      setCronError(err instanceof Error ? err.message : String(err));
    } finally {
      setHealthLoading(false);
    }
  };

  const handleCronJobs = async () => {
    setCronIsRunning(true);
    setCronResult(null);
    setCronError(null);

    try {
      const { triggerCronJobs } = await import("../server/cron");
      const res = await triggerCronJobs();
      setCronResult(res);
    } catch (err) {
      setCronError(err instanceof Error ? err.message : String(err));
    } finally {
      setCronIsRunning(false);
    }
  };

  const handleSegmentStats = async () => {
    setSegmentBusy(true);
    setSegmentError(null);
    try {
      const { fetchSegmentIngestStats } =
        await import("../server/segments-admin");
      setSegmentStats(await fetchSegmentIngestStats());
    } catch (err) {
      setSegmentError(err instanceof Error ? err.message : String(err));
    } finally {
      setSegmentBusy(false);
    }
  };

  const handleSegmentBackfill = async () => {
    setSegmentBusy(true);
    setSegmentEnqueued(null);
    setSegmentError(null);
    try {
      const { enqueueSegmentBackfill, fetchSegmentIngestStats } =
        await import("../server/segments-admin");
      const res = await enqueueSegmentBackfill({
        data: { limit: segmentLimit },
      });
      setSegmentEnqueued(res.enqueued);
      setSegmentStats(await fetchSegmentIngestStats());
    } catch (err) {
      setSegmentError(err instanceof Error ? err.message : String(err));
    } finally {
      setSegmentBusy(false);
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        className="dev-tools__toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="Dev Tools"
        id="dev-tools-toggle"
      >
        🛠️
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="dev-tools__panel" id="dev-tools-panel">
          <div className="dev-tools__header">
            <h3 className="dev-tools__title">🛠️ Dev Tools</h3>
            <button
              className="dev-tools__close"
              onClick={() => setIsOpen(false)}
              aria-label="Close dev tools"
            >
              ✕
            </button>
          </div>

          <div className="dev-tools__content">
            {/* Reclassify Section */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">
                Route Reclassification
              </h4>
              <p className="dev-tools__section-desc">
                Re-run route &amp; destination classifiers on{" "}
                <strong>all</strong> rides using the latest logic. Rides with
                manual route overrides are preserved.
              </p>
              <button
                className="dev-tools__action-btn"
                onClick={handleReclassify}
                disabled={isRunning}
                id="dev-tools-reclassify-btn"
              >
                {isRunning ? (
                  <>
                    <span className="dev-tools__spinner" />
                    Reclassifying…
                  </>
                ) : (
                  "🔄 Reclassify All Rides"
                )}
              </button>
            </div>

            {/* Sync Prompt Dialog */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">Sync Prompt Dialog</h4>
              <p className="dev-tools__section-desc">
                Show the first-visit sync prompt dialog. Clears the localStorage
                dismissal flag so it reappears.
              </p>
              <button
                className="dev-tools__action-btn"
                onClick={() => {
                  try {
                    localStorage.removeItem("sf2g-sync-prompt-dismissed");
                  } catch {
                    // ignore
                  }
                  window.dispatchEvent(
                    new CustomEvent("sf2g:show-sync-prompt"),
                  );
                }}
                id="dev-tools-sync-prompt-btn"
              >
                💬 Show Sync Prompt
              </button>
            </div>

            {/* Error Display */}
            {error && (
              <div className="dev-tools__error">
                <strong>Error:</strong> {error}
              </div>
            )}

            {/* Result Display */}
            {result && (
              <div className="dev-tools__result">
                <div className="dev-tools__result-header">
                  {result.updated > 0 ? "✅" : "ℹ️"} Reclassification Complete
                  <span className="dev-tools__duration">
                    {result.durationMs < 1000
                      ? `${result.durationMs}ms`
                      : `${(result.durationMs / 1000).toFixed(1)}s`}
                  </span>
                </div>

                <div className="dev-tools__stats-grid">
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {result.totalRides}
                    </span>
                    <span className="dev-tools__stat-label">Total Rides</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {result.updated}
                    </span>
                    <span className="dev-tools__stat-label">Updated</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {result.routeChanges}
                    </span>
                    <span className="dev-tools__stat-label">Route Changes</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {result.destinationChanges}
                    </span>
                    <span className="dev-tools__stat-label">Dest Changes</span>
                  </div>
                  {result.skippedOverrides > 0 && (
                    <div
                      className="dev-tools__stat"
                      style={{ gridColumn: "1 / -1" }}
                    >
                      <span className="dev-tools__stat-value">
                        {result.skippedOverrides}
                      </span>
                      <span className="dev-tools__stat-label">
                        🔒 Skipped (manual overrides)
                      </span>
                    </div>
                  )}
                </div>

                {/* Category transition breakdown */}
                {Object.keys(result.breakdown).length > 0 && (
                  <div className="dev-tools__breakdown">
                    <h5 className="dev-tools__breakdown-title">
                      Category Transitions
                    </h5>
                    {Object.entries(result.breakdown).map(
                      ([transition, count]) => (
                        <div
                          key={transition}
                          className="dev-tools__breakdown-row"
                        >
                          <code>{transition}</code>
                          <span className="dev-tools__breakdown-count">
                            ×{count}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                )}

                {/* Errors from the operation */}
                {result.errors.length > 0 && (
                  <div className="dev-tools__warnings">
                    <h5 className="dev-tools__breakdown-title">
                      ⚠️ Warnings ({result.errors.length})
                    </h5>
                    {result.errors.map((err, i) => (
                      <div key={i} className="dev-tools__warning-item">
                        {err}
                      </div>
                    ))}
                  </div>
                )}

                {/* Debug Samples */}
                {result.debug && result.debug.length > 0 && (
                  <div className="dev-tools__breakdown">
                    <h5 className="dev-tools__breakdown-title">
                      🔍 Debug: First {result.debug.length} rides
                    </h5>
                    {result.debug.map((d, i) => (
                      <div
                        key={i}
                        className="dev-tools__warning-item"
                        style={{ fontSize: "10px", lineHeight: "1.4" }}
                      >
                        <strong>{d.name ?? "unnamed"}</strong>
                        <br />
                        polyline:{" "}
                        {d.hasPolyline
                          ? `✅ (${d.polylineLen} chars)`
                          : "❌ none"}
                        <br />
                        start: {JSON.stringify(d.startLatlng)}
                        <br />
                        end: {JSON.stringify(d.endLatlng)}
                        <br />
                        dist:{" "}
                        {d.distance
                          ? `${(d.distance / 1000).toFixed(1)}km`
                          : "null"}{" "}
                        | elev:{" "}
                        {d.elevation ? `${d.elevation.toFixed(0)}m` : "null"}
                        <br />
                        old: <strong>{d.oldCategory ?? "null"}</strong> → new:{" "}
                        <strong>{d.newCategory}</strong> ({d.method},{" "}
                        {d.confidence})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Divider */}
            <hr
              style={{
                border: "none",
                borderTop: "1px solid var(--color-border)",
                margin: "var(--space-4) 0",
              }}
            />

            {/* Sync Queue Section */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">🕐 Sync Queue</h4>
              <p className="dev-tools__section-desc">
                Run one Cron Trigger tick now: queue riders not synced in 12
                hours, then drain the queue within one invocation&apos;s budget.
              </p>
              <button
                className="dev-tools__action-btn"
                onClick={handleCronJobs}
                disabled={cronIsRunning || isRunning}
                id="dev-tools-cron-btn"
              >
                {cronIsRunning ? (
                  <>
                    <span className="dev-tools__spinner" />
                    Running tick…
                  </>
                ) : (
                  "⚡ Run Queue Tick"
                )}
              </button>
            </div>

            {cronError && (
              <div className="dev-tools__error">
                <strong>Error:</strong> {cronError}
              </div>
            )}

            {cronResult && (
              <div className="dev-tools__result">
                <div className="dev-tools__result-header">
                  ✅ Tick complete ({cronResult.durationMs}ms · stopped:{" "}
                  {cronResult.stopReason})
                </div>
                <div className="dev-tools__result-stats">
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {cronResult.done}
                    </span>
                    <span className="dev-tools__stat-label">Done</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {cronResult.requeued}
                    </span>
                    <span className="dev-tools__stat-label">Requeued</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {cronResult.failed}
                    </span>
                    <span className="dev-tools__stat-label">Failed</span>
                  </div>
                </div>
                {cronResult.jobs.length > 0 && (
                  <ul className="dev-tools__job-list">
                    {cronResult.jobs.map((j) => (
                      <li key={j.id}>
                        #{j.id} {j.kind}: {j.status} — {j.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Sync Health Section */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">🩺 Sync Health</h4>
              <p className="dev-tools__section-desc">
                Every connected rider, least recently synced first.
              </p>
              <button
                className="dev-tools__action-btn"
                onClick={handleSyncHealth}
                disabled={healthLoading}
                id="dev-tools-sync-health-btn"
              >
                {healthLoading ? "Loading…" : "🩺 Load Sync Health"}
              </button>
              {health && (
                <>
                  <p className="dev-tools__section-desc">
                    Queue: {health.queue.queued ?? 0} queued ·{" "}
                    {health.queue.running ?? 0} running ·{" "}
                    {health.queue.failed ?? 0} failed
                  </p>
                  <div className="dev-tools__health-wrap">
                    <table className="dev-tools__health">
                      <thead>
                        <tr>
                          <th>Rider</th>
                          <th>Last success</th>
                          <th>Jobs</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {health.riders.map((r) => (
                          <tr key={r.userId}>
                            <td>{r.displayName ?? r.userId.slice(0, 8)}</td>
                            <td>
                              {r.lastSyncSuccessAt
                                ? new Date(r.lastSyncSuccessAt).toLocaleString()
                                : "never"}
                            </td>
                            <td>
                              {r.openJobs}
                              {r.failedJobs > 0
                                ? ` (${r.failedJobs} failed)`
                                : ""}
                            </td>
                            <td title={r.lastSyncError ?? undefined}>
                              {r.needsReauth
                                ? "⚠️ reconnect"
                                : r.lastSyncError
                                  ? "❌ error"
                                  : "✅"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Segments Section */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">⛰️ Segments</h4>
              <p className="dev-tools__section-desc">
                Queue one Strava activity-detail read per unfetched Skyline ride
                (opted-in riders first, newest first). The queue tick drains
                them.
              </p>
              <label className="dev-tools__section-desc">
                Rides to queue{" "}
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={segmentLimit}
                  onChange={(e) =>
                    setSegmentLimit(Number(e.target.value) || 500)
                  }
                  id="dev-tools-segment-limit"
                  style={{ width: "6em" }}
                />
              </label>
              <button
                className="dev-tools__action-btn"
                onClick={handleSegmentBackfill}
                disabled={segmentBusy}
                id="dev-tools-segment-backfill-btn"
              >
                {segmentBusy ? "Working…" : "⛰️ Backfill segment efforts"}
              </button>
              <button
                className="dev-tools__action-btn"
                onClick={handleSegmentStats}
                disabled={segmentBusy}
                id="dev-tools-segment-stats-btn"
              >
                📊 Load segment stats
              </button>
              {segmentError && (
                <div className="dev-tools__error">
                  <strong>Error:</strong> {segmentError}
                </div>
              )}
              {segmentEnqueued !== null && (
                <p className="dev-tools__section-desc">
                  Queued {segmentEnqueued} rides.
                </p>
              )}
              {segmentStats && (
                <p className="dev-tools__section-desc">
                  Skyline rides: {segmentStats.rides_pending} pending ·{" "}
                  {segmentStats.rides_fetched} fetched
                  <br />
                  Segments: {segmentStats.segments_corridor} on corridor /{" "}
                  {segmentStats.segments_total} total · {segmentStats.efforts}{" "}
                  efforts
                  <br />
                  Jobs: {segmentStats.open_jobs} open ·{" "}
                  {segmentStats.failed_jobs} failed
                </p>
              )}
            </div>

            {/* Divider */}
            <hr
              style={{
                border: "none",
                borderTop: "1px solid var(--color-border)",
                margin: "var(--space-4) 0",
              }}
            />

            {/* Debug Connected Users Section */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">
                🔗 Debug Connected Users
              </h4>
              <p className="dev-tools__section-desc">
                Fetch all users who have connected their Strava account and log
                them to the console.
              </p>
              <button
                className="dev-tools__action-btn"
                onClick={async () => {
                  try {
                    const { fetchAllConnectedUsers } =
                      await import("../server/users");
                    const users = await fetchAllConnectedUsers();

                    console.group("🔗 All Connected Users");
                    console.log(`Total connected: ${users.length}`);
                    console.log("");

                    for (const u of users) {
                      console.log(
                        `${u.display_name ?? "Unknown"} | strava_id: ${u.strava_id} | last_sync: ${u.last_sync_at ?? "never"} | joined: ${u.created_at}`,
                      );
                    }

                    console.groupEnd();
                    console.table(
                      users.map((u) => ({
                        Name: u.display_name ?? "Unknown",
                        "Strava ID": u.strava_id,
                        "Last Sync": u.last_sync_at ?? "never",
                        Joined: u.created_at,
                      })),
                    );
                  } catch (err) {
                    console.error("Failed to fetch connected users:", err);
                  }
                }}
                id="dev-tools-connected-users-btn"
              >
                🔗 Log Connected Users
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dev-tools__job-list {
          margin: var(--space-2) 0 0;
          padding-left: var(--space-4);
          font-size: 12px;
        }
        .dev-tools__health-wrap {
          max-height: 260px;
          overflow: auto;
        }
        .dev-tools__health {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .dev-tools__health th,
        .dev-tools__health td {
          padding: 2px 6px;
          text-align: left;
          border-bottom: 1px solid var(--color-border);
          white-space: nowrap;
        }
        .dev-tools__toggle {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          width: 44px;
          height: 44px;
          border-radius: var(--radius-full);
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          backdrop-filter: blur(12px);
          cursor: pointer;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
          transition: all var(--transition-fast);
        }
        .dev-tools__toggle:hover {
          transform: scale(1.1) rotate(15deg);
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
          border-color: var(--color-strava);
        }

        .dev-tools__panel {
          position: fixed;
          bottom: 76px;
          right: 20px;
          z-index: 9998;
          width: 380px;
          max-height: calc(100vh - 120px);
          overflow-y: auto;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-xl);
          box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
          animation: dev-tools-slide-up 0.25s ease-out;
        }

        @keyframes dev-tools-slide-up {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .dev-tools__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-3) var(--space-4);
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface);
          border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        }

        .dev-tools__title {
          font-size: var(--text-sm);
          font-weight: var(--font-bold);
          color: var(--color-text);
          margin: 0;
          letter-spacing: -0.01em;
        }

        .dev-tools__close {
          width: 28px;
          height: 28px;
          border: none;
          background: transparent;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: var(--text-sm);
          color: var(--color-text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
        }
        .dev-tools__close:hover {
          background: var(--color-surface-hover);
          color: var(--color-text);
        }

        .dev-tools__content {
          padding: var(--space-4);
        }

        .dev-tools__section {
          margin-bottom: var(--space-4);
        }

        .dev-tools__section-title {
          font-size: var(--text-sm);
          font-weight: var(--font-semibold);
          color: var(--color-text);
          margin: 0 0 var(--space-1) 0;
        }

        .dev-tools__section-desc {
          font-size: var(--text-xs);
          color: var(--color-text-muted);
          margin: 0 0 var(--space-3) 0;
          line-height: 1.5;
        }

        .dev-tools__action-btn {
          width: 100%;
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: linear-gradient(135deg, var(--color-strava), #e04500);
          color: #ffffff;
          font-size: var(--text-sm);
          font-weight: var(--font-semibold);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          transition: all var(--transition-base);
        }
        .dev-tools__action-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(252, 76, 2, 0.4);
        }
        .dev-tools__action-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .dev-tools__spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #ffffff;
          border-radius: var(--radius-full);
          animation: spin 0.8s linear infinite;
        }

        .dev-tools__error {
          padding: var(--space-3);
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: var(--radius-md);
          color: #ef4444;
          font-size: var(--text-xs);
          margin-bottom: var(--space-3);
        }

        .dev-tools__result {
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        .dev-tools__result-header {
          padding: var(--space-2) var(--space-3);
          background: var(--color-surface);
          font-size: var(--text-sm);
          font-weight: var(--font-semibold);
          color: var(--color-text);
          border-bottom: 1px solid var(--color-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .dev-tools__duration {
          font-size: var(--text-xs);
          font-weight: var(--font-medium);
          color: var(--color-text-muted);
          font-family: 'SF Mono', 'Menlo', monospace;
        }

        .dev-tools__stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: var(--color-border);
        }

        .dev-tools__stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: var(--space-3);
          background: var(--color-bg);
        }

        .dev-tools__stat-value {
          font-size: var(--text-xl);
          font-weight: var(--font-bold);
          color: var(--color-text);
          line-height: 1;
        }

        .dev-tools__stat-label {
          font-size: var(--text-xs);
          color: var(--color-text-muted);
          margin-top: var(--space-1);
        }

        .dev-tools__breakdown {
          padding: var(--space-3);
          border-top: 1px solid var(--color-border);
        }

        .dev-tools__breakdown-title {
          font-size: var(--text-xs);
          font-weight: var(--font-semibold);
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 0 0 var(--space-2) 0;
        }

        .dev-tools__breakdown-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-1) 0;
          font-size: var(--text-xs);
        }

        .dev-tools__breakdown-row code {
          font-family: 'SF Mono', 'Menlo', monospace;
          color: var(--color-text-secondary);
          font-size: 11px;
        }

        .dev-tools__breakdown-count {
          font-weight: var(--font-bold);
          color: var(--color-strava);
          font-size: var(--text-xs);
        }

        .dev-tools__warnings {
          padding: var(--space-3);
          border-top: 1px solid var(--color-border);
        }

        .dev-tools__warning-item {
          font-size: 11px;
          color: var(--color-text-muted);
          padding: var(--space-1) 0;
          border-bottom: 1px solid var(--color-border);
          word-break: break-word;
        }
        .dev-tools__warning-item:last-child {
          border-bottom: none;
        }

        @media (max-width: 480px) {
          .dev-tools__panel {
            width: calc(100vw - 40px);
            right: 20px;
            left: 20px;
          }
        }

        @media (max-width: 768px) {
          .dev-tools__toggle {
            width: 28px;
            height: 28px;
            font-size: 12px;
            opacity: 0.3;
            bottom: calc(3.5rem + env(safe-area-inset-bottom) + 8px);
            right: 8px;
            box-shadow: none;
            border-color: transparent;
            background: var(--color-surface-elevated);
          }
          .dev-tools__toggle:hover {
            opacity: 0.8;
            transform: none;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          }
        }
      `}</style>
    </>
  );
}
