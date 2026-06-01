import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

function NotFoundComponent() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      textAlign: 'center',
      padding: '2rem',
      gap: '1rem',
    }}>
      <h1 style={{ fontSize: '4rem', margin: 0, opacity: 0.3 }}>404</h1>
      <p style={{ fontSize: '1.25rem', margin: 0, opacity: 0.7 }}>
        This page doesn't exist.
      </p>
      <Link
        to="/"
        style={{
          marginTop: '1rem',
          padding: '0.6rem 1.5rem',
          borderRadius: '8px',
          background: 'var(--color-accent, #fc4c02)',
          color: '#fff',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        Back to Home
      </Link>
    </div>
  )
}

export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFoundComponent,
  })

  return router
}

// TanStack Start v1.170+ expects getRouter (async factory)
export async function getRouter() {
  return createRouter()
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
