import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

  it("matches the column grant in migration 036", () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../../supabase/migrations/036_lock_down_rpcs_and_user_tokens.sql",
      ),
      "utf8",
    );
    const grant = sql.match(/GRANT SELECT \(([^)]+)\)\s+ON public\.users/);
    expect(grant).not.toBeNull();
    const granted = grant![1].split(",").map((c) => c.trim());
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
