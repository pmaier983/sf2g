/**
 * /api/cron handler — the work must be awaited and reported.
 *
 * Regression: the old handler returned 202 and left runCronJobs() as a
 * dangling promise, which Cloudflare Workers cancel. Nothing was ever synced
 * while the GitHub Action reported success. Scheduled syncing now runs from
 * the Cloudflare Cron Trigger; this endpoint runs the same tick on demand.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const runScheduledTick = vi.fn();
const runMaintenance = vi.fn();
const runGroupRides = vi.fn();

const runReport = vi.fn();
const reportError = vi.fn(async () => "recorded");

vi.mock("../cron", () => ({ runMaintenance, runGroupRides }));
vi.mock("../scheduled", () => ({ runScheduledTick }));
vi.mock("../report", () => ({
  runReport,
  defaultReportDeps: () => ({}),
}));
vi.mock("../report-error", () => ({ reportError }));
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
    const res = await handleCronRequest(post("drain", "nope"));
    expect(res.status).toBe(401);
    expect(runScheduledTick).not.toHaveBeenCalled();
  });

  it("rejects an unknown task", async () => {
    const res = await handleCronRequest(post("reclassify"));
    expect(res.status).toBe(400);
  });

  it("awaits one queue tick and returns its counts with 200", async () => {
    let finished = false;
    runScheduledTick.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      finished = true;
      return {
        claimed: 3,
        done: 2,
        requeued: 1,
        failed: 0,
        stopReason: "claimed_all",
      };
    });

    const res = await handleCronRequest(post());
    expect(finished).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      task: "drain",
      claimed: 3,
      done: 2,
    });
  });

  it("keeps task=sync as an alias of drain", async () => {
    runScheduledTick.mockResolvedValue({ claimed: 0, done: 0, failed: 0 });
    const body = await (await handleCronRequest(post("sync"))).json();
    expect(body).toMatchObject({ ok: true, task: "sync" });
    expect(runScheduledTick).toHaveBeenCalledOnce();
  });

  it("reports ok:false when a job failed for good", async () => {
    runScheduledTick.mockResolvedValue({ claimed: 2, done: 1, failed: 1 });
    const body = await (await handleCronRequest(post("drain"))).json();
    expect(body.ok).toBe(false);
  });

  it("runs maintenance and reports refresh errors", async () => {
    runMaintenance.mockResolvedValue({
      refreshed: [],
      errors: ["refresh_ride_co_occurrences: boom"],
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

  it("runs the monthly report with period/dry/force and omits the bodies", async () => {
    runReport.mockResolvedValue({
      kind: "month",
      period: "2026-09",
      status: "stored",
      subject: "SF2G September 2026",
      html: "<html>…</html>",
      text: "…",
      sentTo: null,
      error: null,
      notes: [],
    });
    const body = await (
      await handleCronRequest(
        post("monthly-report&period=2026-09&dry=1&force=1"),
      )
    ).json();
    expect(runReport).toHaveBeenCalledWith(
      { kind: "month", period: "2026-09", send: false, force: true },
      expect.anything(),
    );
    expect(body).toMatchObject({
      ok: true,
      task: "monthly-report",
      kind: "month",
      period: "2026-09",
      status: "stored",
    });
    expect(body).not.toHaveProperty("html");
  });

  it("runs the weekly report for the previous week by default", async () => {
    runReport.mockResolvedValue({
      kind: "week",
      period: "2026-10-19",
      status: "sent",
      subject: "SF2G week of Oct 19",
      html: "<html>…</html>",
      text: "…",
      sentTo: "p@example.com",
      error: null,
      notes: [],
    });
    const body = await (await handleCronRequest(post("weekly-report"))).json();
    expect(runReport).toHaveBeenCalledWith(
      { kind: "week", period: undefined, send: true, force: false },
      expect.anything(),
    );
    expect(body).toMatchObject({
      ok: true,
      task: "weekly-report",
      kind: "week",
      period: "2026-10-19",
      status: "sent",
    });
  });

  it("rejects a malformed period without running anything", async () => {
    const res = await handleCronRequest(post("monthly-report&period=Sept"));
    expect(res.status).toBe(500);
    expect(runReport).not.toHaveBeenCalled();
    const week = await handleCronRequest(post("weekly-report&period=2026-10"));
    expect(week.status).toBe(500);
    expect(runReport).not.toHaveBeenCalled();
  });

  it("records a crash in app_errors and returns 500", async () => {
    runScheduledTick.mockRejectedValue(new Error("claim_sync_jobs: down"));
    const res = await handleCronRequest(post("drain"));
    expect(res.status).toBe(500);
    expect(reportError).toHaveBeenCalledWith(
      "api/cron",
      expect.objectContaining({ message: "claim_sync_jobs: down" }),
      expect.objectContaining({ task: "drain" }),
    );
  });

  it("returns 500 with the message when a task crashes", async () => {
    runScheduledTick.mockRejectedValue(new Error("claim_sync_jobs: boom"));
    const res = await handleCronRequest(post("drain"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("claim_sync_jobs: boom");
  });
});
