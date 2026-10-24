/**
 * Cookie-based session management for SF2G.
 *
 * Uses `@tanstack/react-start/server` for cookie operations
 * (compatible with TanStack Start's server runtime).
 * Session data is base64url JSON plus an HMAC-SHA256 signature
 * (`<payload>.<signature>`, keyed by SESSION_SECRET) in an HTTP-only cookie.
 * Unsigned or tampered cookies are rejected, so a session cannot be forged
 * from a public user id.
 *
 * The cookie functions are dynamically imported to avoid triggering
 * TanStack Start's import-protection plugin when this module is
 * transitively reachable from client code (e.g., DevToolsPanel →
 * cron.ts → sync.ts → session.ts). The functions are only ever
 * called inside createServerFn handlers, so the dynamic import
 * always resolves at runtime.
 *
 * NO `Buffer` usage — uses `btoa`/`atob` with base64url conversion
 * for Cloudflare Workers compatibility.
 */

const SESSION_COOKIE = "sf2g_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionData {
  userId: string; // UUID
  stravaId: number;
}

/** What is actually signed: the session plus an absolute expiry (epoch seconds). */
interface SignedPayload extends SessionData {
  exp: number;
}

/** Minimum SESSION_SECRET length; shorter secrets are treated as missing. */
const MIN_SECRET_LENGTH = 32;

// ---------------------------------------------------------------------------
// Base64url helpers (Cloudflare Workers compatible — no Buffer)
// ---------------------------------------------------------------------------

/**
 * Encode a string to base64url (URL-safe base64 without padding).
 * Uses `btoa` which is available in all modern runtimes including Workers.
 */
function toBase64Url(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url string back to a regular string.
 * Uses `atob` which is available in all modern runtimes including Workers.
 */
function fromBase64Url(base64url: string): string {
  // Restore standard base64
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");

  // Re-add padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += "==";
  else if (pad === 3) base64 += "=";

  return atob(base64);
}

// ---------------------------------------------------------------------------
// Signing (WebCrypto HMAC-SHA256 — available in Workers and Node)
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return toBase64Url(bin);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bin = fromBase64Url(value);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Read SESSION_SECRET, or null if it is missing or too short. */
function getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

/**
 * Encode and sign a session. Exported for tests; use setSessionData() in app code.
 */
export async function encodeSession(
  data: SessionData,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: SignedPayload = {
    userId: data.userId,
    stravaId: data.stravaId,
    exp: nowSeconds + MAX_AGE_SECONDS,
  };
  const body = toBase64Url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

/**
 * Verify and decode a session cookie value. Returns null for unsigned,
 * tampered, malformed or expired values. Exported for tests.
 */
export async function decodeSession(
  raw: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionData | null> {
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot !== raw.lastIndexOf(".")) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      base64UrlToBytes(sig),
      new TextEncoder().encode(body),
    );
    if (!valid) return null;

    const parsed = JSON.parse(fromBase64Url(body)) as SignedPayload;
    if (
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      typeof parsed.stravaId !== "number" ||
      typeof parsed.exp !== "number" ||
      parsed.exp < nowSeconds
    ) {
      return null;
    }
    return { userId: parsed.userId, stravaId: parsed.stravaId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lazy cookie helpers — dynamic import avoids import-protection errors
// ---------------------------------------------------------------------------

async function _getCookie(name: string): Promise<string | undefined> {
  const mod = await import("@tanstack/react-start/server");
  return mod.getCookie(name);
}

async function _setCookie(
  name: string,
  value: string,
  options: Record<string, unknown>,
): Promise<void> {
  const mod = await import("@tanstack/react-start/server");
  mod.setCookie(name, value, options);
}

async function _deleteCookie(
  name: string,
  options: Record<string, unknown>,
): Promise<void> {
  const mod = await import("@tanstack/react-start/server");
  mod.deleteCookie(name, options);
}

// ---------------------------------------------------------------------------
// Session API
// ---------------------------------------------------------------------------

/**
 * Read the current session from the cookie.
 * Returns `null` if no session cookie exists or if it's invalid.
 */
export async function getSessionData(): Promise<SessionData | null> {
  const raw = await _getCookie(SESSION_COOKIE);
  if (!raw) return null;

  const secret = getSessionSecret();
  if (!secret) {
    console.error(
      "[session] SESSION_SECRET is missing or shorter than 32 characters — rejecting all sessions",
    );
    return null;
  }

  return decodeSession(raw, secret);
}

/**
 * Set the session cookie with the given data.
 * Cookie is HTTP-only, secure in production, and lasts 30 days.
 */
export async function setSessionData(data: SessionData): Promise<void> {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters — refusing to issue an unsigned session",
    );
  }
  const encoded = await encodeSession(data, secret);

  await _setCookie(SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

/**
 * Clear the session cookie (logout).
 */
export async function clearSessionData(): Promise<void> {
  await _deleteCookie(SESSION_COOKIE, {
    path: "/",
  });
}
