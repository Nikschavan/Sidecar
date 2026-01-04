/**
 * SSE Routes
 *
 * Server-Sent Events endpoint for real-time updates
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { sseServer, type SSEEventType } from '../sse/server.js'
import { validateToken } from '../auth/token.js'
import { claudeService } from '../services/claude.service.js'

export const sseRoutes = new Hono()

// SSE endpoint for session events
// GET /api/events/:sessionId?token=xxx
sseRoutes.get('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')

  // Validate token from query param (EventSource can't set headers)
  const token = c.req.query('token')
  if (!token || !validateToken(token)) {
    return c.json({ error: 'Unauthorized: invalid or missing token' }, 401)
  }

  // Set headers to prevent proxy buffering (critical for SSE through proxies)
  c.header('X-Accel-Buffering', 'no') // nginx
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
  c.header('Connection', 'keep-alive')

  return streamSSE(c, async (stream) => {
    const clientId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Register client with SSE server
    sseServer.addClient(sessionId, clientId, (event: SSEEventType, data: unknown) => {
      stream.writeSSE({
        event,
        data: JSON.stringify(data),
      })
    })

    // Watch session for file-based updates (terminal Claude sessions)
    // This enables polling for new messages and permission requests
    claudeService.watchSession(clientId, sessionId)

    // Get any pending permissions that existed before we connected
    const pendingPermissions = claudeService.getPendingPermissions(sessionId)

    // Send connected event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ sessionId }),
    })

    // Send an immediate ping to help flush proxy buffers
    await stream.writeSSE({
      event: 'heartbeat',
      data: JSON.stringify({ timestamp: Date.now() }),
    })

    // Send any pending permissions from before we connected
    for (const permission of pendingPermissions) {
      await stream.writeSSE({
        event: 'permission_request',
        data: JSON.stringify({
          sessionId,
          requestId: permission.requestId,
          toolName: permission.toolName,
          toolUseId: permission.toolUseId,
          input: permission.input,
          source: permission.source
        }),
      })
    }

    // Heartbeat to keep connection alive (every 15 seconds - shorter for proxies)
    const heartbeatInterval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ timestamp: Date.now() }),
        })
      } catch {
        // Connection closed
        clearInterval(heartbeatInterval)
      }
    }, 15000)

    // Handle disconnect
    stream.onAbort(() => {
      clearInterval(heartbeatInterval)
      sseServer.removeClient(clientId)
      claudeService.unwatchSession(clientId, sessionId)
    })

    // Keep connection open indefinitely
    // The while loop prevents the stream from closing
    while (true) {
      await stream.sleep(60000) // Sleep for 60 seconds between checks
    }
  })
})
