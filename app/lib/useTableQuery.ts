/**
 * The /leaderboard TableQuery from the URL, plus the only ways to change it.
 * `set` applies `patchQuery` rules (page resets, per-view sort reset, preset
 * vs custom dates), so every control behaves the same.
 */
import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  DEFAULT_TABLE_QUERY,
  effectiveDateRange,
  patchQuery,
  type TableQuery,
} from "./table-query";

export function useTableQuery() {
  const query = useSearch({ from: "/leaderboard" }) as TableQuery;
  const navigate = useNavigate({ from: "/leaderboard" });

  const set = useCallback(
    (patch: Partial<TableQuery>) =>
      navigate({
        search: (prev) => patchQuery(prev as TableQuery, patch),
      }),
    [navigate],
  );

  const reset = useCallback(
    () => navigate({ search: DEFAULT_TABLE_QUERY }),
    [navigate],
  );

  // Recomputed per render: a preset like "today" follows the clock.
  const { dateFrom, dateTo } = effectiveDateRange(query);
  const dates = useMemo(() => ({ dateFrom, dateTo }), [dateFrom, dateTo]);

  return { query, set, reset, dates };
}
