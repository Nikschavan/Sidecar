/**
 * Serve embedded web assets
 *
 * When running as a Bun-compiled binary, serves the embedded web UI.
 * Falls back gracefully when running in development mode.
 */

import type { Context, Next } from 'hono'

interface EmbeddedAsset {
  path: string
  file: string
  mimeType: string
}

let assetMap: Map<string, EmbeddedAsset> | null = null
let loadAttempted = false

/**
 * Check if running as a Bun-compiled binary
 */
export function isBunCompiled(): boolean {
  const bunMain = (globalThis as any).Bun?.main ?? ''
  return bunMain.includes('$bunfs') || bunMain.includes('/~BUN/')
}

/**
 * Load embedded assets (only works in compiled binary)
 */
async function loadAssetMap(): Promise<Map<string, EmbeddedAsset> | null> {
  if (loadAttempted) return assetMap
  loadAttempted = true

  if (!isBunCompiled()) {
    console.log('[web] Running in development mode - embedded assets not available')
    return null
  }

  try {
    const { embeddedAssets } = await import('./embeddedAssets.generated.js')
    assetMap = new Map(embeddedAssets.map((asset: EmbeddedAsset) => [asset.path, asset]))
    console.log(`[web] Loaded ${assetMap.size} embedded assets`)
    return assetMap
  } catch (error) {
    console.log('[web] Embedded assets not found - web UI will not be served')
    return null
  }
}

/**
 * Serve an embedded asset using Bun.file()
 */
function serveAsset(asset: EmbeddedAsset): Response {
  const Bun = (globalThis as any).Bun
  return new Response(Bun.file(asset.file), {
    headers: {
      'Content-Type': asset.mimeType,
      'Cache-Control': asset.path.includes('/assets/')
        ? 'public, max-age=31536000, immutable' // Hashed assets - cache forever
        : 'public, max-age=0, must-revalidate', // HTML - always revalidate
    },
  })
}

/**
 * Hono middleware to serve embedded web assets
 */
export async function embeddedAssetsMiddleware(c: Context, next: Next): Promise<Response | void> {
  const map = await loadAssetMap()

  if (!map) {
    return next()
  }

  const path = c.req.path

  // Skip API and health routes
  if (path.startsWith('/api/') || path === '/health') {
    return next()
  }

  // Try to serve exact path
  const asset = map.get(path)
  if (asset) {
    return serveAsset(asset)
  }

  // SPA fallback: serve index.html for non-file paths
  if (!path.includes('.')) {
    const indexAsset = map.get('/index.html')
    if (indexAsset) {
      return serveAsset(indexAsset)
    }
  }

  return next()
}

/**
 * Initialize embedded assets (call during server startup)
 */
export async function initEmbeddedAssets(): Promise<boolean> {
  const map = await loadAssetMap()
  return map !== null
}
