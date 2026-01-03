/**
 * Sidecar Server
 *
 * Main entry point - HTTP (Hono) + WebSocket server for Claude sessions
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { Hono } from 'hono'
import { app } from './app.js'
import { createWSServer } from './ws/server.js'
import { claudeService } from './services/claude.service.js'
import { sessionsService } from './services/sessions.service.js'
import { setupClaudeHooks, removeClaudeHooks } from './claude/hooks.js'
import { loadOrCreateToken, rotateToken, getAuthFilePath } from './auth/token.js'
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

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server: httpServer })

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
})

claudeService.onPermissionResolved((sessionId, toolId) => {
  ws.broadcast({
    type: 'permission_resolved',
    sessionId,
    toolId
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
├─────────────────────────────────────────┤
│  HTTP:  http://localhost:${PORT}          │
│  WS:    ws://localhost:${PORT}            │
│  CWD:   ${CWD.slice(0, 30)}...
└─────────────────────────────────────────┘

Authentication:
  Token: ${AUTH_TOKEN}
  File:  ${getAuthFilePath()}

  Use --rotate-token to generate a new token

API Endpoints (require Authorization: Bearer <token>):
  GET  /api/claude/sessions       List Claude sessions
  GET  /api/claude/sessions/:id   Get session messages
  POST /api/claude/sessions/:id/send  Send message to session
  GET  /api/sessions              List Sidecar sessions
  POST /api/sessions              Create session

WebSocket (requires ?token=<token>):
  ws://localhost:${PORT}?token=<token>
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
