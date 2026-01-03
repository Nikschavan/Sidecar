/**
 * Health Routes
 */

import { Hono } from 'hono'

export const healthRoutes = new Hono()

// Root endpoint
healthRoutes.get('/', (c) => {
  return c.json({
    name: 'Sidecar Server',
    version: '0.0.1',
    status: 'ok',
    endpoints: {
      health: '/health',
      sessions: '/api/sessions',
      websocket: 'ws://localhost:3456'
    }
  })
})

// Health check
healthRoutes.get('/health', (c) => {
  return c.json({ status: 'ok' })
})
