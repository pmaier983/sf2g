import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAdminUser, parseAdminIds } from "../admin";

describe("isAdminUser", () => {
  const prod = { NODE_ENV: "production", ADMIN_USER_IDS: "aaa, bbb" };

  it("allows everything on a local dev server", () => {
    expect(isAdminUser(null, { NODE_ENV: "development" })).toBe(true);
  });

  it("allows only listed user ids in production", () => {
    expect(isAdminUser("aaa", prod)).toBe(true);
    expect(isAdminUser("bbb", prod)).toBe(true);
    expect(isAdminUser("ccc", prod)).toBe(false);
    expect(isAdminUser(null, prod)).toBe(false);
  });

  it("denies everyone in production when ADMIN_USER_IDS is unset", () => {
    expect(isAdminUser("aaa", { NODE_ENV: "production" })).toBe(false);
  });

  it("parses comma-separated ids, ignoring blanks", () => {
    expect([...parseAdminIds(" a ,, b ,")]).toEqual(["a", "b"]);
  });
});

describe("DevTools server functions are admin-gated", () => {
  const cases: Array<[string, string]> = [
    ["../../server/reclassify.ts", "triggerReclassify"],
    ["../../server/cron.ts", "triggerCronJobs"],
    ["../../server/users.ts", "fetchAllConnectedUsers"],
  ];
  for (const [file, fn] of cases) {
    it(`${fn} calls assertAdmin()`, () => {
      const src = readFileSync(resolve(__dirname, file), "utf8");
      const start = src.indexOf(`export const ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, start + 600);
      expect(body).toContain("await assertAdmin()");
    });
  }
});
