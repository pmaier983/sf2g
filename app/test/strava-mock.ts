/**
 * Minimal Strava API mock for DB tests: intercepts fetch() calls to
 * www.strava.com and passes everything else (local Supabase) through.
 */
import { vi } from "vitest";

export interface MockActivity {
  id: number;
  name: string;
  type: string;
  manual?: boolean;
  start_date: string;
  start_date_local: string;
  timezone: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  start_latlng: [number, number];
  end_latlng: [number, number];
  map: { summary_polyline: string };
  commute?: boolean;
  private?: boolean;
}

export interface StravaMock {
  calls: string[];
  restore: () => void;
}

export function mockStrava(opts: {
  activities?: MockActivity[];
  refresh?: "ok" | "invalid_grant" | "server_error";
}): StravaMock {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Usage": "1,10",
        "X-ReadRateLimit-Usage": "1,10",
      },
    });

  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.hostname !== "www.strava.com") return realFetch(input, init);
      calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);

      if (url.pathname === "/oauth/token") {
        if (opts.refresh === "invalid_grant")
          return json(
            {
              message: "Bad Request",
              errors: [{ code: "invalid", field: "refresh_token" }],
              error: "invalid_grant",
            },
            400,
          );
        if (opts.refresh === "server_error")
          return json({ message: "Internal error" }, 500);
        return json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 21600,
        });
      }
      const all = [...(opts.activities ?? [])];
      const single = url.pathname.match(/^\/api\/v3\/activities\/(\d+)$/);
      if (single) {
        const a = all.find((x) => x.id === Number(single[1]));
        return a ? json(a) : json({ message: "Record Not Found" }, 404);
      }
      if (url.pathname === "/api/v3/athlete/activities") {
        const after = Number(url.searchParams.get("after") ?? "0");
        const before = Number(url.searchParams.get("before") ?? "0");
        const perPage = Number(url.searchParams.get("per_page") ?? "30");
        const page = Number(url.searchParams.get("page") ?? "1");
        const t = (a: MockActivity) => Date.parse(a.start_date) / 1000;
        let list = all.filter(
          (a) => (!after || t(a) > after) && (!before || t(a) < before),
        );
        // Strava: oldest first with `after`, newest first otherwise
        list.sort((a, b) => (after ? t(a) - t(b) : t(b) - t(a)));
        list = list.slice((page - 1) * perPage, page * perPage);
        return json(list);
      }
      return json({ message: "not mocked" }, 404);
    });
  return { calls, restore: () => spy.mockRestore() };
}
