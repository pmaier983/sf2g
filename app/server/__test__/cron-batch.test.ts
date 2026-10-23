/**
 * syncUserBatch — budgets, failure recording, and continuation semantics.
 *
 * Uses a minimal fake Supabase client: the due-user query resolves to a fixed
 * list, and every `.update(...).eq("id", ...)` is recorded.
 */
import { describe, it, expect, vi } from "vitest";
import { syncUserBatch, CRON_SYNC_OPTIONS, type SyncBatchDeps } from "../cron";
import { CRON_SYNC_BUDGET } from "../../lib/constants";
import type { SyncResult } from "../sync";

interface FakeUser {
  id: string;
  display_name: string;
  consecutive_sync_failures: number;
  last_sync_error: string | null;
}

function user(id: string, failures = 0): FakeUser {
  return {
    id,
    display_name: `Rider ${id}`,
    consecutive_sync_failures: failures,
    last_sync_error: failures ? "previous error" : null,
  };
}

function fakeSupabase(users: FakeUser[], count = users.length) {
  const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const filters: string[] = [];
  const query = {
    select: () => query,
    neq: (col: string) => (filters.push(`neq:${col}`), query),
    ilike: (col: string, v: string) => (
      filters.push(`ilike:${col}:${v}`),
      query
    ),
    is: (col: string) => (filters.push(`is:${col}`), query),
    or: (expr: string) => (filters.push(`or:${expr}`), query),
    order: () => query,
    limit: async () => ({ data: users, count, error: null }),
  };
  const client = {
    from: () => ({
      ...query,
      update: (fields: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updates.push({ id, fields });
          return { error: null };
        },
      }),
    }),
  };
  return {
    client: client as unknown as SyncBatchDeps["supabase"],
    updates,
    filters,
  };
}

function ok(partial: Partial<SyncResult> = {}): SyncResult {
  return {
    newRides: 1,
    totalProcessed: 1,
    errors: [],
    hasMore: false,
    rateLimited: false,
    ...partial,
  };
}

function deps(
  supabase: SyncBatchDeps["supabase"],
  sync: SyncBatchDeps["sync"],
  subrequests: () => number = () => 0,
): SyncBatchDeps {
  return { supabase, sync, subrequests, now: () => 1_800_000_000_000 };
}

describe("syncUserBatch", () => {
  it("only selects riders with a working connection who are due", async () => {
    const { client, filters } = fakeSupabase([]);
    await syncUserBatch(deps(client, vi.fn()));
    expect(filters).toContain("neq:strava_refresh_token");
    expect(filters).toContain("ilike:strava_scopes:%activity:read_all%");
    expect(filters).toContain("is:deauthorized_at");
    const cutoff = new Date(
      1_800_000_000_000 - CRON_SYNC_BUDGET.RESYNC_AFTER_MS,
    ).toISOString();
    expect(filters).toContain(
      `or:last_sync_at.is.null,last_sync_at.lt.${cutoff}`,
    );
  });

  it("syncs in cron mode: one page, no per-user group rides or session clearing", async () => {
    const { client } = fakeSupabase([user("a")]);
    const sync = vi.fn(async () => ok());
    await syncUserBatch(deps(client, sync));
    expect(sync).toHaveBeenCalledWith("a", CRON_SYNC_OPTIONS);
    expect(CRON_SYNC_OPTIONS).toMatchObject({
      maxPages: 1,
      skipGroupRides: true,
      skipLeaderboardRefresh: true,
      skipSameDayRecheck: true,
      clearSessionOnReauth: false,
    });
  });

  it("stops before the subrequest budget would be exceeded", async () => {
    const users = ["a", "b", "c", "d", "e"].map((id) => user(id));
    const { client } = fakeSupabase(users);
    let used = 1; // the due-user query
    const sync = vi.fn(async () => {
      used += 9;
      return ok();
    });
    const res = await syncUserBatch(deps(client, sync, () => used));
    // Starts a user only while used + 10 headroom <= 44:
    // used = 1, 10, 19, 28 → start; 37 + 10 > 44 → stop after 4.
    expect(sync).toHaveBeenCalledTimes(4);
    expect(res.stopReason).toBe("subrequest_budget");
    expect(res.remaining).toBe(1);
  });

  it("caps users per invocation", async () => {
    const users = Array.from({ length: 10 }, (_, i) => user(String(i)));
    const { client } = fakeSupabase(users);
    const res = await syncUserBatch(
      deps(
        client,
        vi.fn(async () => ok()),
      ),
    );
    expect(res.synced).toBe(CRON_SYNC_BUDGET.MAX_USERS_PER_RUN);
    expect(res.stopReason).toBe("user_cap");
  });

  it("keeps partially caught-up riders in the remaining count", async () => {
    const { client } = fakeSupabase([user("a"), user("b")]);
    const sync = vi.fn(async (id: string) => ok({ hasMore: id === "a" }));
    const res = await syncUserBatch(deps(client, sync));
    expect(res.partial).toBe(1);
    expect(res.synced).toBe(1);
    expect(res.remaining).toBe(1);
  });

  it("records failures and moves the rider to the back of the queue", async () => {
    const { client, updates } = fakeSupabase([user("a", 2)]);
    const res = await syncUserBatch(
      deps(
        client,
        vi.fn(async () => {
          throw new Error("SYNC_FAILED:Strava API error");
        }),
      ),
    );
    expect(res.failed).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].fields).toMatchObject({
      consecutive_sync_failures: 3,
      last_sync_error: "SYNC_FAILED:Strava API error",
    });
    expect(updates[0].fields.last_sync_at).toBeTypeOf("string");
  });

  it("classifies dead tokens as needs_reauth, not failures", async () => {
    const { client } = fakeSupabase([user("a")]);
    const res = await syncUserBatch(
      deps(
        client,
        vi.fn(async () => {
          throw new Error(
            "REAUTH_REQUIRED:Your Strava connection has expired.",
          );
        }),
      ),
    );
    expect(res.needsReauth).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.remaining).toBe(0);
  });

  it("clears previous failure state after a successful sync", async () => {
    const { client, updates } = fakeSupabase([user("a", 3)]);
    await syncUserBatch(
      deps(
        client,
        vi.fn(async () => ok()),
      ),
    );
    expect(updates).toEqual([
      {
        id: "a",
        fields: { consecutive_sync_failures: 0, last_sync_error: null },
      },
    ]);
  });

  it("stops the whole batch when Strava is near its rate limit", async () => {
    const { client } = fakeSupabase([user("a"), user("b"), user("c")]);
    const sync = vi.fn(async () => ok({ rateLimited: true, hasMore: true }));
    const res = await syncUserBatch(deps(client, sync));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(res.rateLimited).toBe(true);
    expect(res.stopReason).toBe("rate_limited");
  });

  it("reports the total due count, not just the lookahead page", async () => {
    const { client } = fakeSupabase([user("a")], 37);
    const res = await syncUserBatch(
      deps(
        client,
        vi.fn(async () => ok()),
      ),
    );
    expect(res.eligible).toBe(37);
    expect(res.remaining).toBe(36);
  });
});
