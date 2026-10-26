import { Component, useEffect } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { useRouter } from "@tanstack/react-router";
import { trackError } from "../lib/analytics";
import { errorMessage } from "../lib/errors";

interface ErrorFallbackProps {
  error: unknown;
  /** Clears the error and re-runs the route's loaders. */
  reset?: () => void;
  /** Report to PostHog on mount (off when the caller already did). */
  track?: boolean;
  source?: string;
}

/**
 * What a rider sees when a page fails: a plain message, a way to retry, and
 * the error text so a bug report is useful. Used by the root ErrorBoundary
 * (render errors) and as the router's defaultErrorComponent (loader and
 * server-function errors).
 */
export function ErrorFallback({
  error,
  reset,
  track = true,
  source = "route",
}: ErrorFallbackProps) {
  useEffect(() => {
    if (track) trackError("client", error, { source });
  }, [error, track, source]);

  const message = errorMessage(error);
  return (
    <div
      role="alert"
      style={{
        padding: "2rem",
        textAlign: "center",
        maxWidth: 560,
        margin: "0 auto",
      }}
    >
      <h2>Something went wrong</h2>
      <p style={{ color: "var(--color-text-secondary)", marginTop: "0.5rem" }}>
        The page hit an error. Trying again usually fixes it; if it keeps
        happening, mention the message below.
      </p>
      <pre
        style={{
          marginTop: "1rem",
          padding: "0.75rem",
          textAlign: "left",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "0.8rem",
          color: "var(--color-text-muted)",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
        }}
      >
        {message}
      </pre>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          justifyContent: "center",
          marginTop: "1rem",
        }}
      >
        {reset && (
          <button className="btn btn--primary" onClick={reset}>
            Try again
          </button>
        )}
        <button
          className={reset ? "btn" : "btn btn--primary"}
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

/** Router `defaultErrorComponent`: retry re-runs loaders, not just the render. */
export function RouteErrorFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const router = useRouter();
  return (
    <ErrorFallback
      error={error}
      source="route"
      reset={() => {
        void router.invalidate();
        reset();
      }}
    />
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    trackError("client", error, {
      source: "render",
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorFallback
          error={this.state.error}
          track={false}
          reset={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}
