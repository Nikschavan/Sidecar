/**
 * Route Aggregator
 */

import { Hono } from 'hono'
import { healthRoutes } from './health.routes.js'
import { claudeRoutes } from './claude.routes.js'
import { sessionsRoutes } from './sessions.routes.js'
import { createPushRoutes } from './push.routes.js'

export function createRoutes(vapidPublicKey: string): Hono {
  const routes = new Hono()

  // Health routes (/, /health)
  routes.route('/', healthRoutes)

  // Claude routes (/api/claude/*)
  routes.route('/api/claude', claudeRoutes)

  // Hook route (top-level for backward compatibility)
  routes.post('/api/claude-hook', async (c) => {
    // Forward to claude routes
    const hookData = await c.req.json()
    const { session_id, notification_type, message, cwd } = hookData
    const { claudeService } = await import('../services/claude.service.js')
    claudeService.handleHookNotification(session_id, notification_type, message, cwd)
    return c.json({ ok: true })
  })

  // Session routes (/api/sessions/*)
  routes.route('/api/sessions', sessionsRoutes)

  // Push notification routes (/api/push/*)
  routes.route('/api/push', createPushRoutes(vapidPublicKey))

  return routes
}
