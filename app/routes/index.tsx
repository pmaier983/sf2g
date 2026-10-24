import { createFileRoute, redirect } from "@tanstack/react-router";
import { leaderboardSearch } from "../lib/table-query";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      to: "/leaderboard",
      search: leaderboardSearch(),
    });
  },
  component: () => null,
});
