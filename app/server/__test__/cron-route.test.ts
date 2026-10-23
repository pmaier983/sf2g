/**
 * /api/cron handler — the work must be awaited and reported.
 *
 * Regression: the old handler returned 202 and left runCronJobs() as a
 * dangling promise, which Cloudflare Workers cancel. Nothing was ever synced
 * while the GitHub Action reported success.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const syncUserBatch = vi.fn();
const runMaintenance = vi.fn();
const runGroupRides = vi.fn();

vi.mock("../cron", () => ({ syncUserBatch, runMaintenance, runGroupRides }));
vi.mock("../sync", () => ({ performSync: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ createServiceClient: () => ({}) }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
}));

const { handleCronRequest } = await import("../../routes/api/cron");

function post(task?: string, secret = "s3cret"): Request {
  const url = `https://sf2ging.com/api/cron${task ? `?task=${task}` : ""}`;
  return new Request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
}

describe("POST /api/cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    vi.clearAllMocks();
  });

  it("rejects a wrong secret", async () => {
    const res = await handleCronRequest(post("sync", "nope"));
    expect(res.status).toBe(401);
    expect(syncUserBatch).not.toHaveBeenCalled();
  });

  it("rejects an unknown task", async () => {
    const res = await handleCronRequest(post("reclassify"));
    expect(res.status).toBe(400);
  });

  it("awaits the sync batch and returns its counts with 200", async () => {
    let finished = false;
    syncUserBatch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      finished = true;
      return { eligible: 9, remaining: 3, synced: 6, failed: 0, results: [] };
    });

    const res = await handleCronRequest(post());
    expect(finished).toBe(true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      task: "sync",
      synced: 6,
      remaining: 3,
    });
    expect(body.subrequests).toBeTypeOf("number");
  });

  it("reports ok:false when any rider failed", async () => {
    syncUserBatch.mockResolvedValue({ synced: 5, failed: 1, remaining: 0 });
    const body = await (await handleCronRequest(post("sync"))).json();
    expect(body.ok).toBe(false);
  });

  it("runs maintenance and reports refresh errors", async () => {
    runMaintenance.mockResolvedValue({
      refreshed: ["refresh_leaderboard"],
      errors: ["refresh_ppr_dawn_rides: boom"],
      durationMs: 5,
    });
    const body = await (await handleCronRequest(post("maintenance"))).json();
    expect(body).toMatchObject({ ok: false, task: "maintenance" });
  });

  it("runs group rides", async () => {
    runGroupRides.mockResolvedValue({ ok: true, error: null, durationMs: 5 });
    const body = await (await handleCronRequest(post("groups"))).json();
    expect(body).toMatchObject({ ok: true, task: "groups" });
  });

  it("returns 500 with the message when a task crashes", async () => {
    syncUserBatch.mockRejectedValue(new Error("Failed to load due users"));
    const res = await handleCronRequest(post("sync"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to load due users");
  });
});
