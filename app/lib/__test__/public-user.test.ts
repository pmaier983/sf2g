import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PUBLIC_USER_COLUMNS } from "../public-user";

const SECRET_COLUMNS = [
  "strava_access_token",
  "strava_refresh_token",
  "strava_token_expires_at",
  "strava_scopes",
  "last_sync_error",
  "consecutive_sync_failures",
  "deauthorized_at",
];

const publicColumns = PUBLIC_USER_COLUMNS.split(",").map((c) => c.trim());

describe("PUBLIC_USER_COLUMNS", () => {
  it("never includes OAuth tokens or sync diagnostics", () => {
    for (const secret of SECRET_COLUMNS) {
      expect(publicColumns).not.toContain(secret);
    }
  });

  it("matches the column grants in the migrations (036, 043)", () => {
    const dir = resolve(__dirname, "../../../supabase/migrations");
    const granted = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) => [
        ...readFileSync(resolve(dir, f), "utf8").matchAll(
          /GRANT SELECT \(([^)]+)\)\s+ON public\.users/g,
        ),
      ])
      .flatMap((m) => m[1].split(",").map((c) => c.trim()));
    expect(granted.length).toBeGreaterThan(0);
    expect([...granted].sort()).toEqual([...publicColumns].sort());
  });
});

describe("anon-client user reads", () => {
  it("never select * from users in code that can reach the browser", () => {
    for (const file of ["../../server/users.ts", "../../server/auth.ts"]) {
      const src = readFileSync(resolve(__dirname, file), "utf8");
      expect(src).not.toMatch(/from\(["']users["']\)\s*\.select\(["']\*["']\)/);
    }
  });
});
