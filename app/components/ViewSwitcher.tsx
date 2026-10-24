import type { TableView } from "../lib/table-query";

const VIEWS: { view: TableView; label: string }[] = [
  { view: "riders", label: "👤 Riders" },
  { view: "alltime", label: "🏆 All Time" },
  { view: "rides", label: "🚴 Rides" },
  { view: "groups", label: "👥 Groups" },
];

/** The leaderboard's view switcher — rendered once for every screen size. */
export function ViewSwitcher({
  view,
  onChange,
}: {
  view: TableView;
  onChange: (view: TableView) => void;
}) {
  return (
    <div className="leaderboard__view-toggle" role="group" aria-label="View">
      {VIEWS.map((v) => (
        <button
          key={v.view}
          type="button"
          className={`leaderboard__view-btn${view === v.view ? " leaderboard__view-btn--active" : ""}`}
          onClick={() => onChange(v.view)}
          aria-pressed={view === v.view}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
