/**
 * Hono Application Setup
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { routes } from './routes/index.js'

export const app = new Hono()

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type']
}))

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
