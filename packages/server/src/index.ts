/**
 * Sidecar Server
 *
 * Main entry point - HTTP + WebSocket server for Claude sessions
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createWSServer, type WSClient } from './ws/server.js'
import { createSessionManager } from './session/manager.js'
import { listClaudeSessions, readClaudeSession, getMostRecentSession } from './claude/sessions.js'
import { spawnClaude } from './claude/spawn.js'
import type { ClientMessage } from '@sidecar/shared'

const PORT = parseInt(process.env.PORT || '3456', 10)
const CWD = process.cwd()

// Create session manager
const sessionManager = createSessionManager()

// Track which session each client is subscribed to
const clientSessions = new Map<string, string>()

// Track CLI client and phone clients for relay mode
let cliClient: WSClient | null = null
let currentClaudeSessionId: string | null = null
const phoneClients = new Set<WSClient>()

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

  // Root endpoint
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      name: 'Sidecar Server',
      version: '0.0.1',
      status: 'ok',
      endpoints: {
        health: '/health',
        sessions: '/api/sessions',
        websocket: 'ws://localhost:3456'
      }
    }))
    return
  }

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  // List Claude sessions (read directly from Claude's files)
  if (url.pathname === '/api/claude/sessions' && req.method === 'GET') {
    const sessions = listClaudeSessions(CWD)
    const recentId = getMostRecentSession(CWD)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      cwd: CWD,
      mostRecent: recentId,
      sessions: sessions.map((s) => ({
        id: s.id,
        modifiedAt: s.modifiedAt.toISOString(),
        size: s.size
      }))
    }))
    return
  }

  // Get Claude session messages
  const claudeSessionMatch = url.pathname.match(/^\/api\/claude\/sessions\/([^/]+)$/)
  if (claudeSessionMatch && req.method === 'GET') {
    const sessionId = claudeSessionMatch[1]
    const messages = readClaudeSession(CWD, sessionId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      cwd: CWD,
      messageCount: messages.length,
      messages
    }))
    return
  }

  // Get most recent Claude session
  if (url.pathname === '/api/claude/current' && req.method === 'GET') {
    const sessionId = getMostRecentSession(CWD)
    if (!sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No Claude sessions found' }))
      return
    }
    const messages = readClaudeSession(CWD, sessionId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      cwd: CWD,
      messageCount: messages.length,
      messages
    }))
    return
  }

  // Send message to Claude session (spawns new Claude process with --resume)
  const claudeSendMatch = url.pathname.match(/^\/api\/claude\/sessions\/([^/]+)\/send$/)
  if (claudeSendMatch && req.method === 'POST') {
    const sessionId = claudeSendMatch[1]
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

    console.log(`[server] Sending to Claude session ${sessionId}: ${text.slice(0, 50)}...`)

    // Spawn Claude with --resume to continue the session
    const responses: unknown[] = []
    const claude = spawnClaude({
      cwd: CWD,
      resume: sessionId,
      onMessage: (msg) => {
        responses.push(msg)
        // Broadcast to WebSocket clients (phones)
        ws.broadcast({ type: 'claude_message', message: msg })
      }
    })

    // Send the message
    claude.send(text)

    // Wait for Claude to finish (result message or timeout)
    await new Promise<void>((resolve) => {
      let finished = false

      claude.onMessage((msg) => {
        if (msg.type === 'result' && !finished) {
          finished = true
          setTimeout(resolve, 500) // Small delay to collect final messages
        }
      })

      claude.onExit(() => {
        if (!finished) {
          finished = true
          resolve()
        }
      })

      // Timeout after 2 minutes
      setTimeout(() => {
        if (!finished) {
          finished = true
          claude.child.kill()
          resolve()
        }
      }, 120000)
    })

    // Return the responses
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      messageCount: responses.length,
      responses
    }))
    return
  }

  // Send message to most recent Claude session
  if (url.pathname === '/api/claude/send' && req.method === 'POST') {
    const sessionId = getMostRecentSession(CWD)
    if (!sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No Claude sessions found. Start a claude session first.' }))
      return
    }

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

    console.log(`[server] Sending to most recent session ${sessionId}: ${text.slice(0, 50)}...`)

    const responses: unknown[] = []
    const claude = spawnClaude({
      cwd: CWD,
      resume: sessionId,
      onMessage: (msg) => {
        responses.push(msg)
        ws.broadcast({ type: 'claude_message', message: msg })
      }
    })

    claude.send(text)

    await new Promise<void>((resolve) => {
      let finished = false

      claude.onMessage((msg) => {
        if (msg.type === 'result' && !finished) {
          finished = true
          setTimeout(resolve, 500)
        }
      })

      claude.onExit(() => {
        if (!finished) {
          finished = true
          resolve()
        }
      })

      setTimeout(() => {
        if (!finished) {
          finished = true
          claude.child.kill()
          resolve()
        }
      }, 120000)
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      messageCount: responses.length,
      responses
    }))
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

  onMessage(client, message: ClientMessage) {
    console.log(`[server] Received from ${client.id}:`, message.type)

    // CLI client registration
    if (message.type === 'register_cli') {
      console.log(`[server] CLI registered: ${client.id}`)
      cliClient = client
      return
    }

    // CLI sets the Claude session ID
    if (message.type === 'set_session') {
      currentClaudeSessionId = message.sessionId
      console.log(`[server] Claude session: ${currentClaudeSessionId}`)
      // Notify phone clients
      phoneClients.forEach((phone) => {
        phone.send({ type: 'session_update', sessionId: currentClaudeSessionId })
      })
      return
    }

    // CLI forwards Claude message to phones
    if (message.type === 'claude_message') {
      console.log(`[server] Claude message → ${phoneClients.size} phone(s)`)
      phoneClients.forEach((phone) => {
        phone.send({ type: 'claude_message', message: message.message })
      })
      return
    }

    // Phone registration
    if (message.type === 'register_phone') {
      console.log(`[server] Phone registered: ${client.id}`)
      phoneClients.add(client)
      // Send current session info
      if (currentClaudeSessionId) {
        client.send({ type: 'session_update', sessionId: currentClaudeSessionId })
      }
      return
    }

    // Phone sends message to CLI
    if (message.type === 'phone_send') {
      const text = message.text
      console.log(`[server] Phone message → CLI: ${text.slice(0, 50)}...`)
      if (cliClient) {
        cliClient.send({ type: 'phone_message', text })
      }
      return
    }

    // Phone wants to take over (switch CLI to remote mode)
    if (message.type === 'take_over') {
      console.log(`[server] Phone taking over`)
      if (cliClient) {
        cliClient.send({ type: 'switch_to_remote' })
      }
      return
    }

    // Handle subscribe to session (legacy/web client mode)
    if (message.type === 'subscribe') {
      const sessionId = message.sessionId
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

    // Handle send message (legacy/web client mode)
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
    phoneClients.delete(client)
    if (cliClient?.id === client.id) {
      console.log(`[server] CLI disconnected`)
      cliClient = null
    }
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
  GET  /api/claude/sessions       List Claude sessions (from ~/.claude)
  GET  /api/claude/sessions/:id   Get Claude session messages
  GET  /api/claude/current        Get most recent Claude session
  POST /api/claude/sessions/:id/send  Send message to session (resumes it)
  POST /api/claude/send           Send message to most recent session

  GET  /api/sessions              List Sidecar sessions
  POST /api/sessions              Create session
  GET  /api/sessions/:id          Get session
  GET  /api/sessions/:id/messages Get messages
  POST /api/sessions/:id/messages Send message

WebSocket:
  { type: 'subscribe', sessionId: '...' }
  { type: 'send', text: '...' }
`)
})
