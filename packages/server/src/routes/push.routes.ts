/**
 * Push Notification Routes
 *
 * API endpoints for Web Push subscription management
 */

import { Hono } from 'hono'
import { addSubscription, removeSubscription } from '../push/index.js'

// Validation helper
function isValidSubscription(body: unknown): body is {
  endpoint: string
  keys: { p256dh: string; auth: string }
} {
  if (typeof body !== 'object' || body === null) return false
  const obj = body as Record<string, unknown>

  if (typeof obj.endpoint !== 'string' || obj.endpoint.length === 0) return false
  if (typeof obj.keys !== 'object' || obj.keys === null) return false

  const keys = obj.keys as Record<string, unknown>
  if (typeof keys.p256dh !== 'string' || keys.p256dh.length === 0) return false
  if (typeof keys.auth !== 'string' || keys.auth.length === 0) return false

  return true
}

function isValidUnsubscribe(body: unknown): body is { endpoint: string } {
  if (typeof body !== 'object' || body === null) return false
  const obj = body as Record<string, unknown>
  return typeof obj.endpoint === 'string' && obj.endpoint.length > 0
}

export function createPushRoutes(vapidPublicKey: string): Hono {
  const app = new Hono()

  /**
   * GET /vapid-public-key
   * Returns the public VAPID key for client-side subscription
   */
  app.get('/vapid-public-key', (c) => {
    return c.json({ publicKey: vapidPublicKey })
  })

  /**
   * POST /subscribe
   * Register a new push subscription
   */
  app.post('/subscribe', async (c) => {
    try {
      const body = await c.req.json()

      if (!isValidSubscription(body)) {
        return c.json({ error: 'Invalid subscription payload' }, 400)
      }

      addSubscription({
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth
      })

      console.log(`[push.routes] New push subscription registered: ${body.endpoint.slice(0, 50)}...`)
      return c.json({ ok: true })
    } catch (error) {
      console.error('[push.routes] Failed to parse subscription:', error)
      return c.json({ error: 'Invalid JSON' }, 400)
    }
  })

  /**
   * DELETE /subscribe
   * Remove a push subscription
   */
  app.delete('/subscribe', async (c) => {
    try {
      const body = await c.req.json()

      if (!isValidUnsubscribe(body)) {
        return c.json({ error: 'Invalid unsubscribe payload' }, 400)
      }

      removeSubscription(body.endpoint)

      console.log(`[push.routes] Push subscription removed: ${body.endpoint.slice(0, 50)}...`)
      return c.json({ ok: true })
    } catch (error) {
      console.error('[push.routes] Failed to parse unsubscribe request:', error)
      return c.json({ error: 'Invalid JSON' }, 400)
    }
  })

  return app
}
