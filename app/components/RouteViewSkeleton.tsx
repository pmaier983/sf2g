/** Placeholder with the route view's size while Leaflet and the profile load. */
export function RouteViewSkeleton() {
  return (
    <div className="route-view route-view--loading" aria-hidden="true">
      <div className="route-map route-view__placeholder" />
      <div className="elevation route-view__placeholder route-view__placeholder--chart" />
    </div>
  );
}
