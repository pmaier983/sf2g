/**
 * User server functions.
 *
 * - `fetchUserProfile` — fetches a user's public profile by userId
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import type { User } from "../lib/database.types";

// ---------------------------------------------------------------------------
// fetchUserProfile — fetches a user's public profile
// ---------------------------------------------------------------------------
export const fetchUserProfile = createServerFn({ method: "GET" })
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data }): Promise<User> => {
    const supabase = createAnonClient();

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", data.userId)
      .single();

    if (error || !user) {
      throw new Error(`User not found: ${data.userId}`);
    }

    return user;
  });

// ---------------------------------------------------------------------------
// fetchAllConnectedUsers — all users with a Strava connection (debug tool)
// ---------------------------------------------------------------------------
export const fetchAllConnectedUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    Array<{
      id: string;
      display_name: string | null;
      strava_id: number | null;
      last_sync_at: string | null;
      created_at: string;
    }>
  > => {
    const supabase = createAnonClient();

    // Paginate to work around Supabase max_rows (1000) truncation
    type ConnectedUser = {
      id: string;
      display_name: string | null;
      strava_id: number | null;
      last_sync_at: string | null;
      created_at: string;
    };

    const PAGE_SIZE = 1000;
    const allRows: ConnectedUser[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error: pageError } = await supabase
        .from("users")
        .select("id, display_name, strava_id, last_sync_at, created_at")
        .not("strava_id", "is", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (pageError) {
        throw new Error(`Failed to fetch users: ${pageError.message}`);
      }

      if (!page || page.length === 0) {
        hasMore = false;
      } else {
        allRows.push(...(page as ConnectedUser[]));
        offset += page.length;
        if (page.length < PAGE_SIZE) {
          hasMore = false;
        }
      }
    }

    console.log(`[users] Paginated fetch: ${allRows.length} total rows`);

    const users = allRows;

    return users;
  },
);
