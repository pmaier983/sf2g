/**
 * User server functions.
 *
 * - `fetchUserProfile` — fetches a user's public profile by userId
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient, createServiceClient } from "../lib/supabase";
import { PUBLIC_USER_COLUMNS, type PublicUser } from "../lib/public-user";
import { assertAdmin } from "../lib/admin";

// ---------------------------------------------------------------------------
// fetchUserProfile — fetches a user's public profile
// ---------------------------------------------------------------------------
const fetchUserProfileInput = (input: { userId: string }) => input;

export async function fetchUserProfileImpl(
  data: ReturnType<typeof fetchUserProfileInput>,
): Promise<PublicUser> {
  const supabase = createAnonClient();

  const { data: user, error } = await supabase
    .from("users")
    .select(PUBLIC_USER_COLUMNS)
    .eq("id", data.userId)
    .single();

  if (error || !user) {
    throw new Error(`User not found: ${data.userId}`);
  }

  return user;
}

export const fetchUserProfile = createServerFn({ method: "GET" })
  .inputValidator(fetchUserProfileInput)
  .handler(({ data }) => fetchUserProfileImpl(data));

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
    await assertAdmin();
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

// ---------------------------------------------------------------------------
// fetchSyncHealth — per-rider sync health and queue depth (DevTools, admin)
// ---------------------------------------------------------------------------
export interface SyncHealthRow {
  userId: string;
  displayName: string | null;
  lastSyncAt: string | null;
  lastSyncSuccessAt: string | null;
  needsReauth: boolean;
  openJobs: number;
  failedJobs: number;
  lastSyncError: string | null;
}

export interface SyncHealth {
  riders: SyncHealthRow[];
  queue: Record<string, number>;
}

export const fetchSyncHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<SyncHealth> => {
    await assertAdmin();
    const supabase = createServiceClient();
    const [{ data: riders, error }, { data: jobs }] = await Promise.all([
      supabase
        .from("sync_health")
        .select("*")
        .is("deauthorized_at", null)
        .order("last_sync_success_at", { ascending: true, nullsFirst: true })
        .limit(500),
      supabase
        .from("sync_jobs")
        .select("status")
        .in("status", ["queued", "running", "failed"])
        .limit(1000),
    ]);
    if (error) throw new Error(`Failed to load sync health: ${error.message}`);

    const queue: Record<string, number> = { queued: 0, running: 0, failed: 0 };
    for (const j of jobs ?? []) queue[j.status] = (queue[j.status] ?? 0) + 1;

    return {
      riders: (riders ?? []).map((r) => ({
        userId: r.user_id!,
        displayName: r.display_name,
        lastSyncAt: r.last_sync_at,
        lastSyncSuccessAt: r.last_sync_success_at,
        needsReauth: r.needs_reauth ?? false,
        openJobs: Number(r.open_jobs ?? 0),
        failedJobs: Number(r.failed_jobs ?? 0),
        lastSyncError: r.last_sync_error,
      })),
      queue,
    };
  },
);
