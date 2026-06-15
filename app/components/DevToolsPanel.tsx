import { useState } from "react";
import { triggerReclassify, type ReclassifyResult } from "../server/reclassify";
import {
  triggerWindEnrichment,
  type WindEnrichmentResult,
} from "../server/wind-enrichment";
import type { CronResult } from "../server/cron";

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

  // Wind enrichment state
  const [windIsRunning, setWindIsRunning] = useState(false);
  const [windResult, setWindResult] = useState<WindEnrichmentResult | null>(
    null,
  );
  const [windError, setWindError] = useState<string | null>(null);

  // Cron jobs state
  const [cronIsRunning, setCronIsRunning] = useState(false);
  const [cronResult, setCronResult] = useState<CronResult | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);

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

  const handleWindEnrichment = async () => {
    setWindIsRunning(true);
    setWindResult(null);
    setWindError(null);

    try {
      const res = await triggerWindEnrichment();
      setWindResult(res);
    } catch (err) {
      setWindError(err instanceof Error ? err.message : String(err));
    } finally {
      setWindIsRunning(false);
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

            {/* Wind Enrichment Section */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">Wind Enrichment</h4>
              <p className="dev-tools__section-desc">
                Fetch wind data from Open-Meteo for rides missing tailwind data.
                Processes up to 200 rides per run.
              </p>
              <button
                className="dev-tools__action-btn"
                onClick={handleWindEnrichment}
                disabled={windIsRunning}
                id="dev-tools-wind-btn"
              >
                {windIsRunning ? (
                  <>
                    <span className="dev-tools__spinner" />
                    Enriching…
                  </>
                ) : (
                  "🌬️ Enrich Wind Data"
                )}
              </button>
            </div>

            {/* Wind Error Display */}
            {windError && (
              <div className="dev-tools__error">
                <strong>Error:</strong> {windError}
              </div>
            )}

            {/* Wind Result Display */}
            {windResult && (
              <div className="dev-tools__result">
                <div className="dev-tools__result-header">
                  {windResult.processed > 0 ? "✅" : "ℹ️"} Wind Enrichment
                  Complete
                  <span className="dev-tools__duration">
                    {windResult.durationMs < 1000
                      ? `${windResult.durationMs}ms`
                      : `${(windResult.durationMs / 1000).toFixed(1)}s`}
                  </span>
                </div>

                <div className="dev-tools__stats-grid">
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {windResult.processed}
                    </span>
                    <span className="dev-tools__stat-label">Processed</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {windResult.totalMissing - windResult.processed}
                    </span>
                    <span className="dev-tools__stat-label">Remaining</span>
                  </div>
                </div>

                {/* Wind Errors */}
                {windResult.errors.length > 0 && (
                  <div className="dev-tools__warnings">
                    <h5 className="dev-tools__breakdown-title">
                      ⚠️ Warnings ({windResult.errors.length})
                    </h5>
                    {windResult.errors.map((err, i) => (
                      <div key={i} className="dev-tools__warning-item">
                        {err}
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

            {/* Cron Jobs Section */}
            <div className="dev-tools__section">
              <h4 className="dev-tools__section-title">🕐 Cron Jobs</h4>
              <p className="dev-tools__section-desc">
                Run <strong>all</strong> maintenance tasks: sync all users,
                reclassify rides, and enrich wind data. Same as what the
                external cron endpoint runs.
              </p>
              <button
                className="dev-tools__action-btn"
                onClick={handleCronJobs}
                disabled={cronIsRunning || isRunning || windIsRunning}
                id="dev-tools-cron-btn"
              >
                {cronIsRunning ? (
                  <>
                    <span className="dev-tools__spinner" />
                    Running cron jobs…
                  </>
                ) : (
                  "⚡ Run All Cron Jobs"
                )}
              </button>
            </div>

            {/* Cron Error Display */}
            {cronError && (
              <div className="dev-tools__error">
                <strong>Error:</strong> {cronError}
              </div>
            )}

            {/* Cron Result Display */}
            {cronResult && (
              <div className="dev-tools__result">
                <div className="dev-tools__result-header">
                  ✅ Cron Jobs Complete
                  <span className="dev-tools__duration">
                    {cronResult.totalDurationMs < 1000
                      ? `${cronResult.totalDurationMs}ms`
                      : `${(cronResult.totalDurationMs / 1000).toFixed(1)}s`}
                  </span>
                </div>

                <div className="dev-tools__stats-grid">
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {cronResult.syncAll.synced}
                    </span>
                    <span className="dev-tools__stat-label">Users Synced</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {cronResult.syncAll.failed}
                    </span>
                    <span className="dev-tools__stat-label">Sync Failures</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {cronResult.reclassify.updated}
                    </span>
                    <span className="dev-tools__stat-label">Reclassified</span>
                  </div>
                  <div className="dev-tools__stat">
                    <span className="dev-tools__stat-value">
                      {cronResult.wind.processed}
                    </span>
                    <span className="dev-tools__stat-label">Wind Enriched</span>
                  </div>
                </div>

                {/* Sync details */}
                {cronResult.syncAll.results.length > 0 && (
                  <div className="dev-tools__breakdown">
                    <h5 className="dev-tools__breakdown-title">
                      User Sync Details ({cronResult.syncAll.synced}/
                      {cronResult.syncAll.totalUsers})
                    </h5>
                    {cronResult.syncAll.results
                      .filter((r) => !r.skipped)
                      .map((r) => (
                        <div
                          key={r.userId}
                          className="dev-tools__breakdown-row"
                        >
                          <code>{r.displayName ?? r.userId.slice(0, 8)}</code>
                          <span className="dev-tools__breakdown-count">
                            {r.error ? "❌" : `${r.result?.newRides ?? 0} new`}
                          </span>
                        </div>
                      ))}
                    {cronResult.syncAll.skipped > 0 && (
                      <div className="dev-tools__breakdown-row">
                        <code style={{ color: "var(--color-text-muted)" }}>
                          + {cronResult.syncAll.skipped} skipped (budget)
                        </code>
                        <span />
                      </div>
                    )}
                  </div>
                )}

                {/* Category transition breakdown */}
                {Object.keys(cronResult.reclassify.breakdown).length > 0 && (
                  <div className="dev-tools__breakdown">
                    <h5 className="dev-tools__breakdown-title">
                      Category Transitions
                    </h5>
                    {Object.entries(cronResult.reclassify.breakdown).map(
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

                {/* Combined errors */}
                {(cronResult.reclassify.errors.length > 0 ||
                  cronResult.wind.errors.length > 0 ||
                  cronResult.syncAll.failed > 0) && (
                  <div className="dev-tools__warnings">
                    <h5 className="dev-tools__breakdown-title">
                      ⚠️ Warnings (
                      {cronResult.reclassify.errors.length +
                        cronResult.wind.errors.length +
                        cronResult.syncAll.results.filter((r) => r.error)
                          .length}
                      )
                    </h5>
                    {cronResult.syncAll.results
                      .filter((r) => r.error)
                      .map((r, i) => (
                        <div
                          key={`sync-${i}`}
                          className="dev-tools__warning-item"
                        >
                          [sync] {r.displayName ?? r.userId.slice(0, 8)}:{" "}
                          {r.error}
                        </div>
                      ))}
                    {[
                      ...cronResult.reclassify.errors,
                      ...cronResult.wind.errors,
                    ].map((err, i) => (
                      <div key={i} className="dev-tools__warning-item">
                        {err}
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
