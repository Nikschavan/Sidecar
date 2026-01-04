/**
 * Sidecar Server
 *
 * Main entry point - HTTP (Hono) + WebSocket server for Claude sessions
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { Hono } from 'hono'
import { createApp } from './app.js'
import { createWSServer } from './ws/server.js'
import { claudeService } from './services/claude.service.js'
import { sessionsService } from './services/sessions.service.js'
import { setupClaudeHooks, removeClaudeHooks } from './claude/hooks.js'
import { loadOrCreateToken, rotateToken, getAuthFilePath } from './auth/token.js'
import { formatNetworkUrls } from './utils/network.js'
import { getOrCreateVapidKeys, PushService } from './push/index.js'
import {
  handleSubscribe,
  handleSend,
  handleWatchSession,
  handleAbortSession,
  handlePermissionResponse,
  handleDisconnect
} from './ws/handlers/index.js'
import type { ClientMessage, ServerMessage } from '@sidecar/shared'

const PORT = parseInt(process.env.PORT || '3456', 10)
const CWD = process.cwd()

// Parse CLI args
const args = process.argv.slice(2)
const shouldRotateToken = args.includes('--rotate-token')

// Handle token rotation if requested
if (shouldRotateToken) {
  const newToken = rotateToken()
  console.log(`[auth] Token rotated. New token: ${newToken}`)
}

// Load or create auth token
const AUTH_TOKEN = loadOrCreateToken()

// Initialize VAPID keys and push service
const vapidKeys = getOrCreateVapidKeys()
const pushService = new PushService(vapidKeys)

// Kill any orphaned Claude processes from previous Sidecar runs
claudeService.killOrphanedProcesses()

// Create the Hono app with push support
const app = createApp(vapidKeys.publicKey)

// Create HTTP server that delegates to Hono
const httpServer = createServer(async (req, res) => {
  // Convert Node request to Fetch Request
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  // Read body for POST requests
  let body: string | undefined
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    body = Buffer.concat(chunks).toString()
  }

  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as HeadersInit,
    body
  })

  // Get response from Hono
  const response = await app.fetch(request)

  // Send response
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  const responseBody = await response.text()
  res.end(responseBody)
})

// Create WebSocket server attached to HTTP server with a dedicated path
// Using a /ws path makes it easier to configure reverse proxies for WebSocket
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

const ws = createWSServer(wss, {
  onConnection(client) {
    // Session is null on initial connect, set when client subscribes
    client.send({
      type: 'connected',
      session: null as any
    })
  },

  onMessage(client, message: ClientMessage) {
    console.log(`[server] Received from ${client.id}:`, message.type)

    if (message.type === 'subscribe') {
      handleSubscribe(client, message as { sessionId: string })
      return
    }

    if (message.type === 'send') {
      handleSend(client, message as { text: string })
      return
    }

    if (message.type === 'watch_session') {
      handleWatchSession(client, message as { sessionId: string })
      return
    }

    if (message.type === 'abort_session') {
      handleAbortSession(client, message as { sessionId: string }, (msg) => ws.broadcast(msg as ServerMessage))
      return
    }

    if (message.type === 'permission_response') {
      handlePermissionResponse(client, message as {
        sessionId: string
        requestId: string
        allow: boolean
        allowAll?: boolean
        toolName?: string
        updatedInput?: Record<string, unknown>
        source?: 'file' | 'process'
      })
      return
    }
  },

  onClose(client) {
    handleDisconnect(client.id)
  }
})

// Set up service event handlers to broadcast to WebSocket clients
claudeService.onMessage((sessionId, message) => {
  ws.broadcast({ type: 'claude_message', message, sessionId })
})

claudeService.onPermissionRequest((sessionId, permission) => {
  // Broadcast via WebSocket
  ws.broadcast({
    type: 'permission_request',
    sessionId,
    toolName: permission.toolName,
    toolUseId: permission.toolUseId,
    requestId: permission.requestId,
    input: permission.input,
    source: permission.source,
    permissionSuggestions: permission.permissionSuggestions
  })

  // Send push notification
  pushService.sendToAll({
    title: 'Permission Required',
    body: `Claude needs permission to use ${permission.toolName}`,
    tag: `permission-${sessionId}`,
    data: {
      type: 'permission_request',
      sessionId,
      url: `/#/session/${sessionId}`
    }
  }).catch((err) => {
    console.error('[server] Failed to send push notification:', err)
  })
})

claudeService.onPermissionResolved((sessionId, toolId) => {
  ws.broadcast({
    type: 'permission_resolved',
    sessionId,
    toolId
  })
})

claudeService.onPermissionTimeout((sessionId, requestId, toolName) => {
  ws.broadcast({
    type: 'permission_timeout',
    sessionId,
    requestId,
    toolName,
    message: `Permission request for ${toolName} timed out after 60 seconds`
  })
})

// Set up session manager event handlers
sessionsService.onMessage((sessionId, message) => {
  ws.broadcast({ type: 'message', message, sessionId })
})

sessionsService.onStateChange((sessionId, state) => {
  ws.broadcast({ type: 'state_change', state, sessionId })
})

sessionsService.onSessionReady((sessionId, claudeSessionId) => {
  console.log(`[server] Session ${sessionId} ready with Claude session ${claudeSessionId}`)
})

// Poll watched sessions for permissions and new messages
setInterval(() => {
  claudeService.pollWatchedSessions()
}, 1000)

// Start the server
httpServer.listen(PORT, () => {
  // Configure Claude Code notification hooks (pass token for auth)
  setupClaudeHooks(PORT, AUTH_TOKEN)

  console.log(`
┌─────────────────────────────────────────┐
│           Sidecar Server                │
└─────────────────────────────────────────┘

Web UI:
${formatNetworkUrls(PORT, 'http')}

WebSocket:
${formatNetworkUrls(PORT, 'ws').split('\n').map(line => line.includes('://') ? line.replace(/\/$/, '') + '/ws' : line).join('\n')}

Authentication:
  Token: ${AUTH_TOKEN}
  File:  ${getAuthFilePath()}
`)
})

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[server] Received ${signal}, shutting down...`)
  removeClaudeHooks()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
