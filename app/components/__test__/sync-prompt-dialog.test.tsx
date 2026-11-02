/**
 * The first-visit "Connect with Strava" prompt: shown to signed-out
 * newcomers on the leaderboard pages, never on public reference pages such
 * as /races, which people reach from a shared link and should just read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, renderWithProviders } from "../../test/render";

vi.mock("../../server/auth", () => ({
  getCurrentUser: vi.fn(),
  getMySyncState: vi.fn(),
  logout: vi.fn(),
}));

const { SyncPromptDialog, isSyncPromptExemptPath } =
  await import("../SyncPromptDialog");

// Node's experimental global localStorage (undefined without
// --localstorage-file) shadows happy-dom's; give the component a real one.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

// happy-dom's <dialog> may lack showModal/close.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  localStorage.removeItem("sf2g-sync-prompt-dismissed");
});
afterEach(() => localStorage.removeItem("sf2g-sync-prompt-dismissed"));

async function setup(path: string, user: object | null = null) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(["currentUser"], user);
  const result = renderWithProviders(<SyncPromptDialog />, {
    queryClient,
    path,
  });
  // Let the mount/hydration effects run.
  await new Promise((r) => setTimeout(r, 20));
  return result;
}

describe("SyncPromptDialog", () => {
  it("asks a signed-out first-time visitor to connect on the leaderboard", async () => {
    await setup("/leaderboard");
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("never asks on /races, even on a first visit", async () => {
    await setup("/races");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("also skips /races with filters or an event anchor", async () => {
    await setup("/races?terrain=climb#patterson-pass-road-race-2027");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("does not ask a signed-in rider", async () => {
    await setup("/leaderboard", { id: "u1" });
    expect(document.querySelector("dialog")).toBeNull();
  });
});

describe("isSyncPromptExemptPath", () => {
  it.each([
    ["/races", true],
    ["/races/", true],
    ["/leaderboard", false],
    ["/", false],
    ["/racesx", false],
  ])("%s → %s", (path, exempt) => {
    expect(isSyncPromptExemptPath(path)).toBe(exempt);
  });
});
