/**
 * Public user shape — the only `users` columns that may leave the server.
 *
 * The `users` table also holds Strava OAuth tokens and sync diagnostics.
 * Those must never be selected by the anon client or returned from a server
 * function, so every user read that reaches the browser goes through
 * PUBLIC_USER_COLUMNS. Migration 036 enforces the same list with column-level
 * grants for the `anon` and `authenticated` roles — keep the two in sync.
 */
import type { User } from "./database.types";

// A string literal (not a joined array) so supabase-js can type the result.
export const PUBLIC_USER_COLUMNS =
  "id, strava_id, username, first_name, last_name, display_name, avatar_url, last_sync_at, last_activity_at, created_at, updated_at" as const;

export type PublicUser = Pick<
  User,
  | "id"
  | "strava_id"
  | "username"
  | "first_name"
  | "last_name"
  | "display_name"
  | "avatar_url"
  | "last_sync_at"
  | "last_activity_at"
  | "created_at"
  | "updated_at"
>;
