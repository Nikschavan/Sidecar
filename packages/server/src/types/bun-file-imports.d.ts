/**
 * Type declarations for Bun's `with { type: 'file' }` import syntax
 * These allow importing static files which Bun resolves to file paths at runtime
 */

declare module '*.js' {
  const path: string
  export default path
}

declare module '*.css' {
  const path: string
  export default path
}

declare module '*.html' {
  const path: string
  export default path
}

declare module '*.svg' {
  const path: string
  export default path
}

declare module '*.webmanifest' {
  const path: string
  export default path
}

declare module '*.json' {
  const path: string
  export default path
}
