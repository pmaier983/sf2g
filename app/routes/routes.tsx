import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
const InteractiveMaps = lazy(() =>
  import("../components/InteractiveMap").then((m) => ({
    default: m.InteractiveMaps,
  })),
);
import "../styles/routes.css";
import "../styles/maps.css";

export const Route = createFileRoute("/routes")({
  component: RoutesPage,
  head: () => ({
    meta: [
      { title: "SF2G Routes — Route Corridors, Gateways & Maps" },
      {
        name: "description",
        content:
          "Explore SF2G route corridors, GPS gateway checkpoints, company office locations, and the commute zone classification logic — all on interactive maps.",
      },
    ],
  }),
});

function RoutesPage() {
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const timer = setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div className="routes-page">
      <div className="container">
        {/* Header */}
        <div className="routes-page__header animate-fade-in">
          <h1 className="routes-page__title">SF2G Route Corridors</h1>
        </div>

        {/* Interactive Maps */}
        <Suspense fallback={<div className="map-skeleton" />}>
          <InteractiveMaps />
        </Suspense>
      </div>
    </div>
  );
}
