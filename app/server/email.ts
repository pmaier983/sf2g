/**
 * Outbound email.
 *
 * Cloudflare's own Email Sending is not available on the Workers Free plan,
 * so the monthly report goes through Resend's HTTP API (free tier: 3,000
 * emails/month, 100/day — we send one a month). One subrequest per send.
 *
 * Setup (docs/ops/observability.md): `RESEND_API_KEY` secret,
 * `REPORT_EMAIL_TO` (where the report goes) and optionally
 * `REPORT_EMAIL_FROM`. Without a verified domain, Resend only delivers from
 * `onboarding@resend.dev` to the address that owns the Resend account.
 *
 * The transport is an interface so tests inject a fake and a future provider
 * (e.g. Cloudflare Email Sending on a paid plan) is a drop-in.
 */
import { OUTBOUND_FETCH_TIMEOUT_MS } from "../lib/constants";

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

export const DEFAULT_REPORT_FROM = "SF2G Reports <onboarding@resend.dev>";

export function resendTransport(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): EmailTransport {
  return {
    name: "resend",
    async send(message) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };
      if (!res.ok) {
        throw new Error(
          `Resend ${res.status}${body.name ? ` ${body.name}` : ""}: ${body.message ?? "send failed"}`,
        );
      }
      return { id: body.id ?? "" };
    },
  };
}

export interface EmailConfig {
  transport: EmailTransport | null;
  to: string | null;
  from: string;
}

export function emailConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): EmailConfig {
  const key = env.RESEND_API_KEY?.trim();
  return {
    transport: key ? resendTransport(key, fetchImpl) : null,
    to: env.REPORT_EMAIL_TO?.trim() || null,
    from: env.REPORT_EMAIL_FROM?.trim() || DEFAULT_REPORT_FROM,
  };
}
