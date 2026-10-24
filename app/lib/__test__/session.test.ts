import { describe, it, expect } from "vitest";
import { encodeSession, decodeSession } from "../session";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const OTHER_SECRET = "another-secret-that-is-at-least-32-chars-long!";
const SESSION = {
  userId: "5194a0d6-ae79-422d-8270-3555b09a7c68",
  stravaId: 123,
};
const NOW = 1_800_000_000;

function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("session signing", () => {
  it("round-trips a signed session", async () => {
    const raw = await encodeSession(SESSION, SECRET, NOW);
    expect(await decodeSession(raw, SECRET, NOW)).toEqual(SESSION);
  });

  it("rejects the legacy unsigned cookie format (forgeable from a public user id)", async () => {
    const forged = toBase64Url(JSON.stringify(SESSION));
    expect(await decodeSession(forged, SECRET, NOW)).toBeNull();
  });

  it("rejects a payload swapped to another user", async () => {
    const raw = await encodeSession(SESSION, SECRET, NOW);
    const [, sig] = raw.split(".");
    const evil = toBase64Url(
      JSON.stringify({ ...SESSION, userId: "someone-else", exp: NOW + 1000 }),
    );
    expect(await decodeSession(`${evil}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const raw = await encodeSession(SESSION, OTHER_SECRET, NOW);
    expect(await decodeSession(raw, SECRET, NOW)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const raw = await encodeSession(SESSION, SECRET, NOW);
    const thirtyOneDays = 31 * 24 * 60 * 60;
    expect(await decodeSession(raw, SECRET, NOW + thirtyOneDays)).toBeNull();
  });

  it("rejects garbage", async () => {
    for (const raw of ["", ".", "a.b.c", "not-base64!.sig", "%%%"]) {
      expect(await decodeSession(raw, SECRET, NOW)).toBeNull();
    }
  });
});
