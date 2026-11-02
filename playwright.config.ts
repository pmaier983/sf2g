import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests against `pnpm dev` + the local Supabase fixtures.
 *
 * Two browser time zones: Los Angeles (where riders are) and Kiritimati
 * (UTC+14). At any moment at least one of them is on a different calendar
 * date than the server (UTC), which exposes server/client date mismatches.
 *
 * E2E_PORT runs against (or starts) a dev server on another port, e.g. when
 * several checkouts share this machine: `E2E_PORT=5175 pnpm e2e`.
 */
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "los-angeles",
      use: { ...devices["Desktop Chrome"], timezoneId: "America/Los_Angeles" },
    },
    {
      name: "utc-plus-14",
      use: { ...devices["Desktop Chrome"], timezoneId: "Pacific/Kiritimati" },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
