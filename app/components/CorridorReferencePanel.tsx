/**
 * DevTools: choose a route's reference ride from other riders' rides
 * (phase 09b). Loads the newest SF→G rides of the route, scores them here
 * in the browser (the most typical ride first), and downloads the chosen
 * ride's streams for scripts/gen-corridor-profile.ts.
 */
import { useState } from "react";
import { decodePolyline } from "../lib/polyline";
import { rankTypicalRides } from "../lib/corridor-reference";
import type {
  ReferenceCandidate,
  ReferenceCategory,
} from "../server/corridor-reference";

interface Row extends ReferenceCandidate {
  scoreM: number;
}

export function CorridorReferencePanel() {
  const [category, setCategory] = useState<ReferenceCategory>("bayway");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      const { fetchCorridorReferenceCandidates } =
        await import("../server/corridor-reference");
      const candidates = await fetchCorridorReferenceCandidates({
        data: { category, limit: 200 },
      });
      const byId = new Map(candidates.map((c) => [c.ride_id, c]));
      const ranked = rankTypicalRides(
        candidates.map((c) => ({
          id: c.ride_id,
          line: decodePolyline(c.summary_polyline),
        })),
      );
      setRows(
        ranked
          .slice(0, 5)
          .map((r) => ({ ...byId.get(r.id)!, scoreM: r.scoreM })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async (row: Row) => {
    setBusy(true);
    setError(null);
    try {
      const { fetchCorridorStreams } =
        await import("../server/corridor-reference");
      const res = await fetchCorridorStreams({ data: { rideId: row.ride_id } });
      const blob = new Blob([JSON.stringify(res.streams)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${category}-streams-${res.activityId}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="dev-tools__section-desc">
        Reference ride: the most typical recent SF→G ride of a route (the one
        other rides stay closest to). Download its streams, then run{" "}
        <code>scripts/gen-corridor-profile.ts --corridor {category}</code>.
      </p>
      <label className="dev-tools__section-desc">
        Route{" "}
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as ReferenceCategory);
            setRows(null);
          }}
        >
          <option value="bayway">Bayway</option>
          <option value="hmbw">HMBW</option>
          <option value="skyline">Skyline</option>
        </select>
      </label>
      <button
        className="dev-tools__action-btn"
        onClick={find}
        disabled={busy}
        id="dev-tools-corridor-reference-btn"
      >
        {busy ? "Working…" : "🧭 Find typical rides"}
      </button>
      {error && (
        <div className="dev-tools__error">
          <strong>Error:</strong> {error}
        </div>
      )}
      {rows && (
        <ol className="dev-tools__section-desc" style={{ paddingLeft: 18 }}>
          {rows.map((r) => (
            <li key={r.ride_id}>
              {r.ride_date} · {r.display_name} ·{" "}
              {(r.distance_meters / 1000).toFixed(1)} km · off by{" "}
              {Math.round(r.scoreM)} m{" "}
              <button
                className="dev-tools__action-btn"
                style={{ padding: "2px 6px" }}
                onClick={() => download(r)}
                disabled={busy}
              >
                Streams
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
