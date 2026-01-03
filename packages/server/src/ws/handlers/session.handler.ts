/**
 * Session WebSocket Handlers
 *
 * Handles session-related WebSocket messages
 */

import type { WSClient } from '../server.js'
import { sessionsService } from '../../services/sessions.service.js'
import { claudeService } from '../../services/claude.service.js'
import { findSessionProject } from '../../claude/sessions.js'

const CWD = process.cwd()

// Track which session each client is subscribed to
const clientSessions = new Map<string, string>()

/**
 * Handle subscribe message
 */
export function handleSubscribe(
  client: WSClient,
  message: { sessionId: string }
): void {
  const sessionId = message.sessionId
  const session = sessionsService.getSession(sessionId)

  if (session) {
    clientSessions.set(client.id, sessionId)
    client.send({
      type: 'connected',
      session: {
        id: session.stored.id,
        startTime: session.stored.createdAt,
        cwd: session.stored.cwd,
        state: session.state
      }
    })
    client.send({
      type: 'history',
      messages: sessionsService.getMessages(sessionId)
    })
  }
}

/**
 * Handle send message (legacy/web client mode)
 */
export function handleSend(
  client: WSClient,
  message: { text: string }
): void {
  let sessionId = clientSessions.get(client.id)

  // Auto-create session if none subscribed
  if (!sessionId) {
    const session = sessionsService.getOrCreateSession(CWD)
    sessionId = session.stored.id
    clientSessions.set(client.id, sessionId)
    client.send({
      type: 'connected',
      session: {
        id: session.stored.id,
        startTime: session.stored.createdAt,
        cwd: session.stored.cwd,
        state: session.state
      }
    })
  }

  sessionsService.sendMessage(sessionId, message.text)
}

/**
 * Handle watch_session message
 */
export function handleWatchSession(
  client: WSClient,
  message: { sessionId: string }
): void {
  const { sessionId } = message
  const projectPath = findSessionProject(sessionId)

  if (projectPath) {
    const pendingHook = claudeService.watchSession(client.id, sessionId)

    // Re-send pending hook permission if exists
    if (pendingHook) {
      console.log(`[session.handler] Re-sending pending hook permission for ${sessionId}`)
      client.send({
        type: 'permission_request',
        sessionId,
        toolName: pendingHook.toolName,
        toolUseId: pendingHook.toolUseId,
        requestId: pendingHook.toolUseId,
        input: pendingHook.toolInput,
        source: 'hook'
      })
    }

    // Re-send pending AskUserQuestion tools
    const pendingQuestions = claudeService.getPendingAskUserQuestions(sessionId)
    for (const entry of pendingQuestions) {
      console.log(`[session.handler] Re-sending pending AskUserQuestion: ${entry.tool.id}`)
      client.send({
        type: 'permission_request',
        sessionId,
        toolName: entry.tool.name,
        toolUseId: entry.tool.id,
        requestId: entry.tool.id,
        input: entry.tool.input as Record<string, unknown>,
        source: 'file'
      })
    }
  }
}

/**
 * Handle abort_session message
 */
export function handleAbortSession(
  client: WSClient,
  message: { sessionId: string },
  broadcast: (msg: unknown) => void
): void {
  const { sessionId } = message
  console.log(`[session.handler] Abort request for session ${sessionId}`)

  if (claudeService.abortSession(sessionId)) {
    broadcast({
      type: 'session_aborted',
      sessionId
    })
  } else {
    console.log(`[session.handler] No active process found for session ${sessionId}`)
  }
}

/**
 * Handle permission_response message
 */
export function handlePermissionResponse(
  client: WSClient,
  message: {
    sessionId: string
    requestId: string
    allow: boolean
    allowAll?: boolean
    toolName?: string
    updatedInput?: Record<string, unknown>
    source?: 'file' | 'process'
  }
): void {
  const { sessionId, requestId, allow, allowAll, toolName, updatedInput, source } = message
  console.log(`[session.handler] Permission response for ${sessionId}: ${allow ? 'ALLOW' : 'DENY'}${allowAll ? ' (ALL)' : ''}`)

  claudeService.respondToPermission(sessionId, requestId, allow, {
    allowAll,
    toolName,
    updatedInput
  })
}

/**
 * Handle client disconnect
 */
export function handleDisconnect(clientId: string): void {
  clientSessions.delete(clientId)
  claudeService.handleClientDisconnect(clientId)
}

/**
 * Get session ID for a client
 */
export function getClientSession(clientId: string): string | undefined {
  return clientSessions.get(clientId)
}
