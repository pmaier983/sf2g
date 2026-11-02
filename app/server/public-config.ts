/**
 * Configuration the browser needs that lives in Worker secrets/vars.
 *
 * `VITE_*` variables are inlined by Vite at BUILD time from the machine
 * running `pnpm build`; a Worker secret of the same name never reaches the
 * client bundle. The PostHog project key was configured only as a Worker
 * secret, so analytics (and client error capture) silently did nothing in
 * production. The root route loads this once per page load instead.
 *
 * Only values that are safe to show to anyone belong here.
 */
import { createServerFn } from "@tanstack/react-start";

export interface PublicConfig {
  /** PostHog project API key (public by design), or null when unset. */
  posthogKey: string | null;
}

export function getPublicConfigImpl(
  env: Record<string, string | undefined> = process.env,
): PublicConfig {
  const key = env.VITE_POSTHOG_KEY ?? env.POSTHOG_KEY ?? null;
  return { posthogKey: key && key.startsWith("phc_") ? key : null };
}

export const getPublicConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig> => getPublicConfigImpl(),
);
