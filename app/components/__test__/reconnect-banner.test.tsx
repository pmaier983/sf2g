/**
 * A rider whose Strava refresh token was rejected (users.needs_reauth) sees
 * a reconnect prompt; everyone else sees nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTestQueryClient, renderWithProviders } from "../../test/render";

vi.mock("../../server/auth", () => ({
  getCurrentUser: vi.fn(),
  getMySyncState: vi.fn(),
}));

const { ReconnectBanner } = await import("../ReconnectBanner");

function setup(user: object | null, state: object | null) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(["currentUser"], user);
  queryClient.setQueryData(["mySyncState"], state);
  return renderWithProviders(<ReconnectBanner />, { queryClient });
}

describe("ReconnectBanner", () => {
  it("prompts a rider whose connection expired to reconnect", async () => {
    setup({ id: "u1" }, { needsReauth: true, pendingJobs: 0 });
    const link = await screen.findByRole("link", { name: "Reconnect Strava" });
    expect(link.getAttribute("href")).toBe("/auth/login?force=true");
  });

  it("renders nothing when the connection is fine", async () => {
    const { container } = setup(
      { id: "u1" },
      { needsReauth: false, pendingJobs: 2 },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".reconnect-banner")).toBeNull();
  });

  it("renders nothing when signed out", async () => {
    const { container } = setup(null, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".reconnect-banner")).toBeNull();
  });
});
