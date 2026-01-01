/**
 * Sidecar Server
 *
 * Main entry point - HTTP + WebSocket server for Claude sessions
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createWSServer, type WSClient } from './ws/server.js'
import { createSessionManager } from './session/manager.js'
import type { ClientMessage } from '@sidecar/shared'

const PORT = parseInt(process.env.PORT || '3456', 10)
const CWD = process.cwd()

// Create session manager
const sessionManager = createSessionManager()

// Track which session each client is subscribed to
const clientSessions = new Map<string, string>()

// Create HTTP server
const httpServer = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  // List all sessions
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ sessions: sessionManager.listSessions() }))
    return
  }

  // Create new session
  if (url.pathname === '/api/sessions' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }
    const { cwd } = JSON.parse(body || '{}')
    const session = sessionManager.createSession(cwd || CWD)
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ session: session.stored }))
    return
  }

  // Get session details
  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
  if (sessionMatch && req.method === 'GET') {
    const session = sessionManager.getSession(sessionMatch[1])
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      session: session.stored,
      state: session.state,
      messages: sessionManager.getMessages(session.stored.id)
    }))
    return
  }

  // Get session messages
  const messagesMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/)
  if (messagesMatch && req.method === 'GET') {
    const messages = sessionManager.getMessages(messagesMatch[1])
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ messages }))
    return
  }

  // Send message to session
  if (messagesMatch && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }
    const { text } = JSON.parse(body || '{}')
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'text is required' }))
      return
    }
    sessionManager.sendMessage(messagesMatch[1], text)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer })

const ws = createWSServer(wss, {
  onConnection(client) {
    // Send list of sessions on connect
    client.send({
      type: 'connected',
      session: null as any // Will be set when client subscribes
    })
  },

  onMessage(client, message: ClientMessage & { sessionId?: string }) {
    console.log(`[server] Received from ${client.id}:`, message.type)

    // Handle subscribe to session
    if (message.type === 'subscribe' && 'sessionId' in message) {
      const sessionId = (message as any).sessionId as string
      const session = sessionManager.getSession(sessionId)
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
          messages: sessionManager.getMessages(sessionId)
        })
      }
      return
    }

    // Handle send message
    if (message.type === 'send') {
      let sessionId = clientSessions.get(client.id)

      // Auto-create session if none subscribed
      if (!sessionId) {
        const session = sessionManager.getOrCreateSession(CWD)
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

      sessionManager.sendMessage(sessionId, message.text)
    }
  },

  onClose(client) {
    clientSessions.delete(client.id)
  }
})

// Broadcast messages to subscribed clients
sessionManager.onMessage((sessionId, message) => {
  // Find all clients subscribed to this session
  wss.clients.forEach((wsClient) => {
    // We need to find the client by checking clientSessions
    // This is a bit hacky, but works for now
  })
  ws.broadcast({ type: 'message', message })
})

sessionManager.onStateChange((sessionId, state) => {
  ws.broadcast({ type: 'state_change', state })
})

sessionManager.onSessionReady((sessionId, claudeSessionId) => {
  console.log(`[server] Session ${sessionId} ready with Claude session ${claudeSessionId}`)
})

// Start server
httpServer.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────────┐
│           Sidecar Server                │
├─────────────────────────────────────────┤
│  HTTP:  http://localhost:${PORT}          │
│  WS:    ws://localhost:${PORT}            │
│  CWD:   ${CWD.slice(0, 30)}...
└─────────────────────────────────────────┘

API Endpoints:
  GET  /api/sessions              List sessions
  POST /api/sessions              Create session
  GET  /api/sessions/:id          Get session
  GET  /api/sessions/:id/messages Get messages
  POST /api/sessions/:id/messages Send message

WebSocket:
  { type: 'subscribe', sessionId: '...' }
  { type: 'send', text: '...' }
`)
})
