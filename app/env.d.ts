// CSS modules with ?url suffix (rsbuild/webpack style)
declare module '*.css?url' {
  const url: string
  export default url
}

// Regular CSS modules
declare module '*.css' {
  const classes: Record<string, string>
  export default classes
}

// Image imports
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}
declare module '*.jpeg' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}
declare module '*.webp' {
  const src: string
  export default src
}

// PostHog analytics environment variables
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string
  readonly VITE_POSTHOG_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
