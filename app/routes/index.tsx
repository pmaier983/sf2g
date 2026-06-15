import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      to: "/leaderboard",
      search: {
        routes: [],
        search: "",
        ppr: false,
        other: false,
        weekends: false,
        company: undefined,
        user: undefined,
        view: "riders" as const,
        duration: "1w",
        chart: false,
        sort: "sf2g_total",
        dir: "desc" as const,
        rSort: "ride_date",
        rDir: "desc" as const,
        page: 1,
        dateFrom: undefined,
        dateTo: undefined,
        datePreset: undefined,
        density: "expanded" as const,
        reverse: false,
        gSort: "date",
        gDir: "desc" as const,
        gPage: 1,
      },
    });
  },
  component: () => null,
});
