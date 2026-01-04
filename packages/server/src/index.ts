/**
 * Sidecar Server
 *
 * Main entry point - HTTP server with SSE for real-time updates
 */

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createApp } from './app.js'
import { sseServer } from './sse/server.js'
import { claudeService } from './services/claude.service.js'
import { sessionsService } from './services/sessions.service.js'
import { setupClaudeHooks, removeClaudeHooks } from './claude/hooks.js'
import { loadOrCreateToken, rotateToken, getAuthFilePath } from './auth/token.js'
import { formatNetworkUrls } from './utils/network.js'
import { getOrCreateVapidKeys, PushService } from './push/index.js'

const PORT = parseInt(process.env.PORT || '3456', 10)

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

// Create HTTP server that delegates to Hono with streaming support
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

  // Check if this is a streaming response (SSE)
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream') && response.body) {
    // For SSE, filter out headers that Node handles automatically
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      // Skip headers that Node handles for streaming
      const lowerKey = key.toLowerCase()
      if (lowerKey !== 'transfer-encoding' && lowerKey !== 'content-length') {
        headers[key] = value
      }
    })

    // Write headers (Node will add Transfer-Encoding: chunked automatically)
    res.writeHead(response.status, headers)

    // Pipe the stream to the response
    const reader = response.body.getReader()

    const pump = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          // Write chunk and flush immediately for SSE
          res.write(value)
        }
      } catch (err) {
        // Client disconnected or stream error
        console.log('[server] SSE stream ended')
      } finally {
        res.end()
      }
    }

    // Start pumping (don't await - let it run async)
    pump()
  } else {
    // For regular responses, send headers and body
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    const responseBody = await response.text()
    res.end(responseBody)
  }
})

// Set up service event handlers to broadcast to SSE clients
claudeService.onMessage((sessionId, message) => {
  sseServer.sendToSession(sessionId, 'claude_message', { message, sessionId })
})

claudeService.onPermissionRequest((sessionId, permission) => {
  // Broadcast via SSE
  sseServer.sendToSession(sessionId, 'permission_request', {
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
  sseServer.sendToSession(sessionId, 'permission_resolved', {
    sessionId,
    toolId
  })
})

claudeService.onPermissionTimeout((sessionId, requestId, toolName) => {
  sseServer.sendToSession(sessionId, 'permission_timeout', {
    sessionId,
    requestId,
    toolName,
    message: `Permission request for ${toolName} timed out after 60 seconds`
  })
})

// Set up session manager event handlers
sessionsService.onMessage((sessionId, message) => {
  sseServer.sendToSession(sessionId, 'message', { message, sessionId })
})

sessionsService.onStateChange((sessionId, state) => {
  sseServer.sendToSession(sessionId, 'state_change', { state, sessionId })
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

SSE Events:
${formatNetworkUrls(PORT, 'http').split('\n').map(line => line.includes('://') ? line.replace(/\/$/, '') + '/api/events/:sessionId' : line).join('\n')}

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
