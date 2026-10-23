/**
 * Admin gate for DevTools / maintenance server functions.
 *
 * The DevTools panel only renders on localhost, but its server functions are
 * deployed everywhere and their ids ship in the client bundle. Every such
 * function must call `assertAdmin()` first.
 *
 * Allowed when either:
 * - running a local dev server (NODE_ENV === "development"), or
 * - the signed session belongs to a user id listed in ADMIN_USER_IDS
 *   (comma-separated UUIDs, set as a Cloudflare secret/var).
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

export function isAdminUser(
  userId: string | null | undefined,
  env: { NODE_ENV?: string; ADMIN_USER_IDS?: string } = process.env,
): boolean {
  if (env.NODE_ENV === "development") return true;
  if (!userId) return false;
  return parseAdminIds(env.ADMIN_USER_IDS).has(userId);
}

export async function assertAdmin(): Promise<void> {
  if (process.env.NODE_ENV === "development") return;
  const session = await getSessionData();
  if (!isAdminUser(session?.userId)) {
    throw new Error("Forbidden");
  }
}
