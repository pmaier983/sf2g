/**
 * Lightweight request accounting for Cloudflare Workers.
 *
 * On the Free plan an invocation may make at most 50 subrequests (every
 * Supabase REST call and every Strava call is one). `trackSubrequests` counts
 * outgoing `fetch` calls made while `fn` runs, so long-running jobs can stop
 * before they hit the cap, and every job can log what it cost.
 *
 * Counting is done by wrapping `globalThis.fetch` for the duration of `fn`.
 * Nested trackers share the same counter stack; concurrent requests in the
 * same isolate may inflate each other's counts slightly, which errs on the
 * safe side for budgeting.
 */

type Counter = { count: number };

const active: Counter[] = [];
let originalFetch: typeof fetch | null = null;

function install(): void {
  if (originalFetch) return;
  originalFetch = globalThis.fetch;
  const wrapped: typeof fetch = (...args) => {
    for (const c of active) c.count++;
    return originalFetch!(...args);
  };
  globalThis.fetch = wrapped;
}

function uninstall(): void {
  if (!originalFetch || active.length > 0) return;
  globalThis.fetch = originalFetch;
  originalFetch = null;
}

/**
 * Run `fn` while counting outgoing fetches. `fn` receives a function that
 * returns the count so far; the final count is returned with the result.
 */
export async function trackSubrequests<T>(
  fn: (count: () => number) => Promise<T>,
): Promise<{ result: T; subrequests: number }> {
  const counter: Counter = { count: 0 };
  install();
  active.push(counter);
  try {
    const result = await fn(() => counter.count);
    return { result, subrequests: counter.count };
  } finally {
    active.splice(active.indexOf(counter), 1);
    uninstall();
  }
}

/** One structured log line per job: `[perf] <name> subreq=<n> ms=<n>`. */
export function logPerf(
  name: string,
  subrequests: number,
  startedAt: number,
): void {
  console.log(
    `[perf] ${name} subreq=${subrequests} ms=${Math.round(Date.now() - startedAt)}`,
  );
}

/**
 * Wrap a server-function body so every call logs
 * `[perf] <name> subreq=<n> ms=<n>`. A function that needs more than a
 * handful of subrequests is a bug (see CLAUDE.md).
 */
export function withPerf<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const startedAt = Date.now();
    const { result, subrequests } = await trackSubrequests(() => fn(...args));
    logPerf(name, subrequests, startedAt);
    return result;
  };
}
