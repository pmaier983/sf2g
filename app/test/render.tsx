/**
 * Render a component inside the providers the app's components expect:
 * a TanStack Query client (no retries, no network) and a memory router so
 * `<Link>` works. The router renders `ui` at the root route.
 */
import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { queryClient?: QueryClient; path?: string } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = opts.queryClient ?? createTestQueryClient();
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [opts.path ?? "/"] }),
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
