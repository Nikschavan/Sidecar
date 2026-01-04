/**
 * Sessions Routes
 *
 * All /api/sessions/* endpoints (Sidecar sessions)
 */

import { Hono } from 'hono'
import { sessionsService } from '../services/sessions.service.js'

const CWD = process.cwd()

export const sessionsRoutes = new Hono()

// List all sessions
sessionsRoutes.get('/', (c) => {
  return c.json({ sessions: sessionsService.listSessions() })
})

// Create new session
sessionsRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { cwd } = body
  const session = sessionsService.createSession(cwd || CWD)
  return c.json({ session: session.stored }, 201)
})

// Get session details
sessionsRoutes.get('/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId')
  const session = sessionsService.getSession(sessionId)

  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json({
    session: session.stored,
    state: session.state,
    messages: sessionsService.getMessages(session.stored.id)
  })
})

// Get session messages
sessionsRoutes.get('/:sessionId/messages', (c) => {
  const sessionId = c.req.param('sessionId')
  const messages = sessionsService.getMessages(sessionId)
  return c.json({ messages })
})

// Send message to session
sessionsRoutes.post('/:sessionId/messages', async (c) => {
  const sessionId = c.req.param('sessionId')
  const body = await c.req.json().catch(() => ({}))
  const { text } = body

  if (!text) {
    return c.json({ error: 'text is required' }, 400)
  }

  sessionsService.sendMessage(sessionId, text)
  return c.json({ ok: true })
})

// Abort session (stop Claude processing)
sessionsRoutes.post('/:sessionId/abort', async (c) => {
  const sessionId = c.req.param('sessionId')

  // Import claudeService dynamically to avoid circular deps
  const { claudeService } = await import('../services/claude.service.js')
  const success = claudeService.abortSession(sessionId)

  if (success) {
    // Notify SSE clients about the abort
    const { sseServer } = await import('../sse/server.js')
    sseServer.sendToSession(sessionId, 'session_aborted', { sessionId })
    return c.json({ ok: true })
  }

  return c.json({ error: 'No active process found for session' }, 404)
})
