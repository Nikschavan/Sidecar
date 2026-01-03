/**
 * Hono Application Setup
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { routes } from './routes/index.js'
import { authMiddleware } from './middleware/auth.js'

/**
 * Create a new Hono app instance
 * Using a factory function allows creating fresh instances for testing
 */
export function createApp(): Hono {
  const app = new Hono()

  // CORS middleware
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization']
  }))

  // Auth middleware for /api/* routes
  app.use('/api/*', authMiddleware)

  // Mount all routes
  app.route('/', routes)

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404)
  })

  // Error handler
  app.onError((err, c) => {
    console.error(`[server] Error: ${err.message}`)
    return c.json({ error: err.message }, 500)
  })

  return app
}

// Default app instance for production use
export const app = createApp()
