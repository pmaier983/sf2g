/**
 * Admin gate for DevTools / maintenance server functions.
 *
 * The DevTools panel only renders on localhost, but its server functions are
 * deployed everywhere and their ids ship in the client bundle. Every such
 * function must call `assertAdmin()` first.
 *
 * Allowed when either:
 * - running a local dev server (NODE_ENV === "development") against a LOCAL
 *   database, or
 * - the signed session belongs to a user id listed in ADMIN_USER_IDS
 *   (comma-separated UUIDs, set as a Cloudflare secret/var).
 *
 * A dev server whose SUPABASE_URL is not local (e.g. .env.local pointed at
 * production) gets no bypass at all: DevTools actions like "Run Queue Tick"
 * or "Reclassify" must never write to production from a laptop.
 */
import { getSessionData } from "./session";

export function parseAdminIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

type AdminEnv = {
  NODE_ENV?: string;
  ADMIN_USER_IDS?: string;
  SUPABASE_URL?: string;
};

function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return true; // unset: nothing to reach
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Throws when a local dev server is pointed at a non-local database. */
export function assertSafeDevDatabase(env: AdminEnv = process.env): void {
  if (env.NODE_ENV === "development" && !isLocalDatabase(env.SUPABASE_URL)) {
    throw new Error(
      `Refusing: this local dev server points at a non-local database (${env.SUPABASE_URL}). ` +
        "Admin actions only run against the local database (pnpm db:start) or on the deployed site.",
    );
  }
}

export function isAdminUser(
  userId: string | null | undefined,
  env: AdminEnv = process.env,
): boolean {
  if (env.NODE_ENV === "development") return isLocalDatabase(env.SUPABASE_URL);
  if (!userId) return false;
  return parseAdminIds(env.ADMIN_USER_IDS).has(userId);
}

export async function assertAdmin(): Promise<void> {
  assertSafeDevDatabase();
  if (process.env.NODE_ENV === "development") return;
  const session = await getSessionData();
  if (!isAdminUser(session?.userId)) {
    throw new Error("Forbidden");
  }
}
