/**
 * DevTools: segment curation for one corridor (phase 09a, §4.2).
 *
 * - "Curate segments" reruns app/lib/segment-curation.ts over the corridor.
 * - The table is the ride-share chart: every corridor segment, ordered along
 *   the line, with its share of fetched rides as a bar. The core is where the
 *   bars stay high; that is how SEGMENT_CORRIDORS[…].core was chosen.
 * - Per segment: hide (never selectable) and curated rank (always selectable).
 */
import { useState } from "react";
import { SEGMENT_CORRIDORS, type SegmentCorridor } from "../lib/constants";
import type { CurationCandidate } from "../lib/segment-curation";

const km = (m: number | null) => (m === null ? "–" : (m / 1000).toFixed(1));

export function SegmentCurationPanel() {
  const [corridor, setCorridor] = useState<SegmentCorridor>("skyline");
  const [rows, setRows] = useState<CurationCandidate[] | null>(null);
  const [direction, setDirection] = useState<"south" | "north">("south");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const load = () =>
    run(async () => {
      const { fetchSegmentCuration } = await import("../server/segments-admin");
      setRows(await fetchSegmentCuration({ data: { corridor } }));
    });

  const curate = () =>
    run(async () => {
      const { curateSelectableSegments, fetchSegmentCuration } =
        await import("../server/segments-admin");
      const r = await curateSelectableSegments({ data: { corridor } });
      setMessage(
        `Curated: ${r.selected.south} southbound + ${r.selected.north} northbound selectable, ${r.duplicates} duplicates, ${r.changed} rows changed.`,
      );
      setRows(await fetchSegmentCuration({ data: { corridor } }));
    });

  const save = (row: CurationCandidate, patch: Partial<CurationCandidate>) =>
    run(async () => {
      const { setSegmentCuration } = await import("../server/segments-admin");
      const next = { ...row, ...patch };
      await setSegmentCuration({
        data: {
          id: row.id,
          hidden: next.hidden,
          curated_rank: next.curated_rank,
        },
      });
      setRows((prev) =>
        prev ? prev.map((r) => (r.id === row.id ? next : r)) : prev,
      );
      setMessage("Saved. Run “Curate segments” to apply.");
    });

  const core = SEGMENT_CORRIDORS[corridor].core;
  const shown = (rows ?? []).filter(
    (r) => r.direction === direction && r.terrain !== "descent",
  );

  return (
    <div>
      <label className="dev-tools__section-desc">
        Corridor{" "}
        <select
          value={corridor}
          onChange={(e) => {
            setCorridor(e.target.value as SegmentCorridor);
            setRows(null);
          }}
        >
          {Object.entries(SEGMENT_CORRIDORS).map(([key, c]) => (
            <option key={key} value={key}>
              {c.label}
            </option>
          ))}
        </select>{" "}
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as "south" | "north")}
        >
          <option value="south">Southbound</option>
          <option value="north">Northbound</option>
        </select>
      </label>
      <button
        className="dev-tools__action-btn"
        onClick={curate}
        disabled={busy}
        id="dev-tools-segment-curate-btn"
        title="Choose the selectable segments for this corridor: core, de-duplicated, ridden by ≥ 50 % of rides, at most 40 per direction."
      >
        ✂️ Curate segments
      </button>
      <button
        className="dev-tools__action-btn"
        onClick={load}
        disabled={busy}
        id="dev-tools-segment-curation-btn"
      >
        📈 Ride share by position
      </button>
      {error && (
        <div className="dev-tools__error">
          <strong>Error:</strong> {error}
        </div>
      )}
      {message && <p className="dev-tools__section-desc">{message}</p>}
      {rows && (
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          <p className="dev-tools__section-desc">
            Core: {km(core.startM)}–{km(core.endM)} km. {shown.length} segments.
          </p>
          <table
            style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}
          >
            <thead>
              <tr>
                <th>km</th>
                <th>Segment</th>
                <th>Share</th>
                <th title="Selectable">Sel</th>
                <th>Hide</th>
                <th title="Curated rank: always selectable">Rank</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} style={r.in_core ? undefined : { opacity: 0.5 }}>
                  <td>
                    {km(r.along_start_m)}–{km(r.along_end_m)}
                  </td>
                  <td title={`${r.id} · ${km(r.distance_meters)} km`}>
                    {r.name}
                    {r.duplicate_of !== null && " (dup)"}
                  </td>
                  <td>
                    <span
                      style={{
                        display: "inline-block",
                        height: 8,
                        background: "var(--color-sf2g-orange)",
                        width: `${Math.round(r.ride_share * 60)}px`,
                      }}
                    />{" "}
                    {Math.round(r.ride_share * 100)}%
                  </td>
                  <td>{r.selectable ? "✓" : ""}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.hidden}
                      disabled={busy}
                      onChange={(e) => save(r, { hidden: e.target.checked })}
                      aria-label={`Hide ${r.name}`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      defaultValue={r.curated_rank ?? ""}
                      disabled={busy}
                      style={{ width: "3.5em" }}
                      aria-label={`Curated rank of ${r.name}`}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        const rank = v === "" ? null : Number(v);
                        if (rank !== r.curated_rank)
                          save(r, { curated_rank: rank });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
