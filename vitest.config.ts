import { defineConfig } from "vitest/config";
import path from "path";
import { LOCAL_SUPABASE } from "./app/test/local-supabase";

const resolve = {
  alias: {
    "~": path.resolve(__dirname, "./app"),
  },
};

export default defineConfig({
  resolve,
  test: {
    globals: true,
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          globals: true,
          include: ["app/**/*.test.ts"],
          exclude: ["app/**/__test__/db/**", "app/**/characterization/**"],
        },
      },
      {
        resolve,
        test: {
          name: "component",
          globals: true,
          environment: "happy-dom",
          include: ["app/**/*.test.tsx"],
          setupFiles: ["app/test/setup-dom.ts"],
        },
      },
      {
        resolve,
        test: {
          name: "db",
          globals: true,
          include: [
            "app/**/__test__/db/**/*.test.ts",
            "app/**/characterization/**/*.test.ts",
          ],
          globalSetup: ["app/test/db-global-setup.ts"],
          // Tests share one database; run files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
          env: {
            SUPABASE_URL: LOCAL_SUPABASE.url,
            SUPABASE_ANON_KEY: LOCAL_SUPABASE.anonKey,
            SUPABASE_SERVICE_ROLE_KEY: LOCAL_SUPABASE.serviceRoleKey,
            STRAVA_CLIENT_ID: "",
            STRAVA_CLIENT_SECRET: "",
            TZ: "UTC",
          },
        },
      },
    ],
  },
});
