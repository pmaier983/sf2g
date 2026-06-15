import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, lazy, Suspense } from "react";
import { NavBar } from "../components/NavBar";
import { Footer } from "../components/Footer";
const LazyDevToolsPanel = lazy(() =>
  import("../components/DevToolsPanel").then((m) => ({
    default: m.DevToolsPanel,
  })),
);
import { ToastProvider } from "../components/Toast";
import { SyncPromptDialog } from "../components/SyncPromptDialog";
import {
  initAnalytics,
  setupGlobalErrorHandlers,
  trackError,
} from "../lib/analytics";
import { ErrorBoundary } from "../components/ErrorBoundary";
// Import CSS as side effects — rsbuild injects them automatically
import "../styles/global.css";
import "../styles/components.css";
import "../styles/group-rides.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (error) => {
        trackError("network", error, { source: "mutation" });
      },
    },
  },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SF2G — San Francisco Commuter Cycling Club" },
      {
        name: "description",
        content:
          "Track and compare SF2G commute rides. Leaderboard, route classification, and ride history powered by Strava.",
      },
      {
        httpEquiv: "Content-Security-Policy",
        content: [
          "default-src 'self'",
          // Scripts: 'self' + inline for theme init + eval for Vite HMR / source maps
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          // Styles: 'self' + inline for Vite HMR + Google Fonts
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
          // Fonts from Google Fonts CDN
          "font-src 'self' https://fonts.gstatic.com",
          // Images: self + Strava CDN (avatars) + data URIs
          "img-src 'self' data: https://*.strava.com https://dgalywyr863hv.cloudfront.net https://*.basemaps.cartocdn.com",
          // API connections: self + Supabase + Strava + PostHog
          "connect-src 'self' https://*.supabase.co https://www.strava.com https://us.i.posthog.com",
          // Workers for map tiles
          "worker-src 'self' blob:",
        ].join("; "),
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/x-icon",
        href: "/favicon.ico",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Open+Sans:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

/**
 * Inline script that runs synchronously before first paint to prevent
 * a flash of the wrong theme (FOUC). It reads the saved preference from
 * localStorage and sets `data-theme` on <html> immediately.
 */
const themeScript = `
  (function() {
    try {
      var saved = localStorage.getItem('sf2g-theme');
      if (saved === 'light' || saved === 'dark') {
        document.documentElement.setAttribute('data-theme', saved);
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } catch(e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
`;

function RootComponent() {
  // Defer dev-tools rendering to after hydration to avoid server/client mismatch.
  // The server has no `window`, so the check must happen in useEffect.
  const [showDevTools, setShowDevTools] = useState(false);

  useEffect(() => {
    if (window.location.hostname === "localhost") {
      setShowDevTools(true);
    }
    initAnalytics();
    setupGlobalErrorHandlers();
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <QueryClientProvider client={queryClient}>
          <ToastProvider />
          <SyncPromptDialog />
          <div className="page-layout">
            <NavBar />
            <main className="page-content">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </main>
            <Footer />
            {showDevTools && (
              <Suspense fallback={null}>
                <LazyDevToolsPanel />
              </Suspense>
            )}
          </div>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
