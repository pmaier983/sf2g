/**
 * Loading, empty and error states shared by every table (existing classes:
 * empty-state, error-state, *__skeleton).
 */
import type { ReactNode } from "react";

export function TableLoading({
  rows,
  columns,
}: {
  rows: number;
  columns: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr
          key={`skeleton-${i}`}
          className="data-table__skeleton-row"
          aria-hidden="true"
        >
          {Array.from({ length: columns }, (_, j) => (
            <td key={j}>
              <div className="data-table__skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function TableEmpty({
  icon = "🔍",
  title = "Nothing to show",
  children,
}: {
  icon?: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state__icon">{icon}</div>
      <h3 className="empty-state__title">{title}</h3>
      {children && <p className="empty-state__description">{children}</p>}
    </div>
  );
}

export function TableError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <div className="error-state__icon">⚠️</div>
      <h3 className="error-state__title">Couldn&apos;t load this table</h3>
      <p className="error-state__message">{error.message}</p>
      {onRetry && (
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </div>
  );
}
