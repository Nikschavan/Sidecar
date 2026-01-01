/**
 * Sidecar Server
 *
 * Main entry point - HTTP + WebSocket server for Claude sessions
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createWSServer, type WSClient } from './ws/server.js'
import { createSessionManager } from './session/manager.js'
import { listClaudeSessions, readClaudeSession, getMostRecentSession, listAllProjects, findSessionProject, getPendingToolCalls, type PendingToolCall } from './claude/sessions.js'
import { spawnClaude, type ClaudeProcess, type PermissionRequest } from './claude/spawn.js'
import type { ClientMessage } from '@sidecar/shared'

const PORT = parseInt(process.env.PORT || '3456', 10)
const CWD = process.cwd()

// Create session manager
const sessionManager = createSessionManager()

// Track which session each client is subscribed to
const clientSessions = new Map<string, string>()

// Track active Claude processes waiting for permission
interface ActiveProcess {
  claude: ClaudeProcess
  sessionId: string
  projectPath: string
  pendingPermission: PermissionRequest | null
  responses: unknown[]
  resolve: () => void
}
const activeProcesses = new Map<string, ActiveProcess>()

// Track allowed tools per session (when user clicks "Allow All")
const allowedToolsBySession = new Map<string, Set<string>>()

// Track which sessions clients are watching (for file-based permission detection)
const watchedSessions = new Map<string, { projectPath: string; lastPendingIds: Set<string> }>()

// Track pending file-based permissions that were broadcast (waiting for user response)
const pendingFilePermissions = new Map<string, PendingToolCall>()

// Track sessions currently being approved via resume (to avoid re-detecting during approval)
const sessionsBeingApproved = new Set<string>()

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

  // List all projects
  if (url.pathname === '/api/claude/projects' && req.method === 'GET') {
    const projects = listAllProjects()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      projects: projects.map((p) => ({
        path: p.path,
        name: p.path.split('/').pop() || p.path,
        modifiedAt: p.modifiedAt.toISOString()
      }))
    }))
    return
  }

  // List Claude sessions for a specific project (by encoded path)
  const projectSessionsMatch = url.pathname.match(/^\/api\/claude\/projects\/(.+)\/sessions$/)
  if (projectSessionsMatch && req.method === 'GET') {
    const projectPath = decodeURIComponent(projectSessionsMatch[1])
    const sessions = listClaudeSessions(projectPath)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      projectPath,
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        modifiedAt: s.modifiedAt.toISOString(),
        size: s.size
      }))
    }))
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
        name: s.name,
        modifiedAt: s.modifiedAt.toISOString(),
        size: s.size
      }))
    }))
    return
  }

  // Get Claude session messages (auto-finds project)
  const claudeSessionMatch = url.pathname.match(/^\/api\/claude\/sessions\/([^/]+)$/)
  if (claudeSessionMatch && req.method === 'GET') {
    const sessionId = claudeSessionMatch[1]
    // Try to find which project this session belongs to
    const projectPath = findSessionProject(sessionId) || CWD
    const messages = readClaudeSession(projectPath, sessionId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      projectPath,
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

    // Find the project this session belongs to
    const projectPath = findSessionProject(sessionId)
    if (!projectPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found in any project' }))
      return
    }

    console.log(`[server] Sending to Claude session ${sessionId} in ${projectPath}: ${text.slice(0, 50)}...`)

    // Spawn Claude with --resume to continue the session
    const responses: unknown[] = []
    let pendingPermission: PermissionRequest | null = null

    const claude = spawnClaude({
      cwd: projectPath,
      resume: sessionId,
      onMessage: (msg) => {
        responses.push(msg)
        // Broadcast to WebSocket clients (phones)
        ws.broadcast({ type: 'claude_message', message: msg, sessionId })
      },
      onPermissionRequest: (permReq) => {
        console.log(`[server] Permission request for ${permReq.toolName}: ${JSON.stringify(permReq.input).slice(0, 100)}`)
        console.log(`[server] Session: ${sessionId}, All allowed sessions: ${JSON.stringify([...allowedToolsBySession.keys()])}`)

        // Check if this tool is already allowed for this session (user clicked "Allow All")
        const allowedTools = allowedToolsBySession.get(sessionId)
        console.log(`[server] Allowed tools for session: ${allowedTools ? [...allowedTools].join(', ') : 'none'}`)
        if (allowedTools?.has(permReq.toolName)) {
          console.log(`[server] Auto-approving ${permReq.toolName} (allowed for session)`)
          claude.sendPermissionResponse(permReq.requestId, true, permReq.input)
          return
        }

        pendingPermission = permReq

        // Update the active process with the pending permission
        const proc = activeProcesses.get(sessionId)
        if (proc) {
          proc.pendingPermission = permReq
        }

        // Broadcast permission request to all connected clients
        ws.broadcast({
          type: 'permission_request',
          sessionId,
          requestId: permReq.requestId,
          toolName: permReq.toolName,
          toolUseId: permReq.toolUseId,
          input: permReq.input,
          permissionSuggestions: permReq.permissionSuggestions
        })
      }
    })

    // Send the message
    claude.send(text)

    // Wait for Claude to finish (result message or timeout)
    let resolvePromise: () => void
    const donePromise = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })

    let finished = false

    claude.onMessage((msg) => {
      if (msg.type === 'result' && !finished) {
        finished = true
        activeProcesses.delete(sessionId)
        setTimeout(resolvePromise, 500) // Small delay to collect final messages
      }
    })

    claude.onExit(() => {
      if (!finished) {
        finished = true
        activeProcesses.delete(sessionId)
        resolvePromise()
      }
    })

    // Store the process for permission responses
    activeProcesses.set(sessionId, {
      claude,
      sessionId,
      projectPath,
      pendingPermission,
      responses,
      resolve: resolvePromise!
    })

    // Timeout after 5 minutes (longer for permission flows)
    setTimeout(() => {
      if (!finished) {
        finished = true
        activeProcesses.delete(sessionId)
        claude.child.kill()
        resolvePromise()
      }
    }, 300000)

    await donePromise

    // Return the responses
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      messageCount: responses.length,
      responses
    }))
    return
  }

  // Respond to permission request for a session
  const permissionMatch = url.pathname.match(/^\/api\/claude\/sessions\/([^/]+)\/permission$/)
  if (permissionMatch && req.method === 'POST') {
    const sessionId = permissionMatch[1]
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }
    const { requestId, allow } = JSON.parse(body || '{}')

    const activeProcess = activeProcesses.get(sessionId)
    if (!activeProcess) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No active process waiting for permission' }))
      return
    }

    const reqId = requestId || activeProcess.pendingPermission?.requestId
    if (!reqId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No pending permission request' }))
      return
    }

    console.log(`[server] Permission response for ${sessionId}: ${reqId} ${allow ? 'allowed' : 'denied'}`)

    // Send permission response to Claude
    activeProcess.claude.sendPermissionResponse(reqId, allow, activeProcess.pendingPermission?.input)
    activeProcess.pendingPermission = null

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, requestId: reqId, allow }))
    return
  }

  // Check if session has pending permission
  const permissionStatusMatch = url.pathname.match(/^\/api\/claude\/sessions\/([^/]+)\/permission$/)
  if (permissionStatusMatch && req.method === 'GET') {
    const sessionId = permissionStatusMatch[1]
    const activeProcess = activeProcesses.get(sessionId)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      hasPendingPermission: !!activeProcess?.pendingPermission,
      permission: activeProcess?.pendingPermission || null
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

    // Find the project this session belongs to
    const projectPath = findSessionProject(sessionId) || CWD

    console.log(`[server] Sending to most recent session ${sessionId} in ${projectPath}: ${text.slice(0, 50)}...`)

    const responses: unknown[] = []
    const claude = spawnClaude({
      cwd: projectPath,
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

    // Handle watch_session - client wants to watch a Claude session for permissions
    if (message.type === 'watch_session') {
      const { sessionId } = message as { sessionId: string }
      const projectPath = findSessionProject(sessionId)
      if (projectPath) {
        // Don't reset if already watching - preserve lastPendingIds
        if (!watchedSessions.has(sessionId)) {
          console.log(`[server] Client ${client.id} watching session ${sessionId}`)
          watchedSessions.set(sessionId, {
            projectPath,
            lastPendingIds: new Set()
          })
        } else {
          console.log(`[server] Client ${client.id} already watching session ${sessionId}`)
        }
      }
      return
    }

    // Handle permission response from web client
    if (message.type === 'permission_response') {
      const { sessionId, requestId, allow, allowAll, toolName, updatedInput, source } = message as {
        sessionId: string
        requestId: string
        allow: boolean
        allowAll?: boolean
        toolName?: string
        updatedInput?: Record<string, unknown>
        source?: 'file' | 'process'
      }
      console.log(`[server] Permission response for ${sessionId}: ${allow ? 'ALLOW' : 'DENY'}${allowAll ? ' (ALL)' : ''}, toolName=${toolName}, source=${source}`)

      // Track tool as allowed if user clicked "Allow All"
      if (allow && allowAll && toolName) {
        console.log(`[server] allowAll=true, adding ${toolName} to allowed tools`)
        let allowedTools = allowedToolsBySession.get(sessionId)
        if (!allowedTools) {
          allowedTools = new Set()
          allowedToolsBySession.set(sessionId, allowedTools)
        }
        allowedTools.add(toolName)
        console.log(`[server] Added ${toolName} to allowed tools for session ${sessionId}`)
      }

      // Check if this is a file-based permission (Claude running in terminal)
      const pendingTool = pendingFilePermissions.get(requestId)
      if (pendingTool) {
        pendingFilePermissions.delete(requestId)
        const watched = watchedSessions.get(sessionId)
        if (watched && allow) {
          console.log(`[server] Approving file-based permission via resume`)
          approveToolViaResume(sessionId, watched.projectPath, pendingTool)
        } else if (!allow) {
          console.log(`[server] User denied file-based permission - cannot deny terminal Claude`)
          // Note: We can't actually deny permissions for terminal Claude
          // The terminal will still be waiting for user input
        }
        return
      }

      // Otherwise, it's an active process permission
      const activeProcess = activeProcesses.get(sessionId)
      if (activeProcess) {
        // Send permission response to Claude process
        activeProcess.claude.sendPermissionResponse(requestId, allow, updatedInput)
        activeProcess.pendingPermission = null
      } else {
        console.log(`[server] No active process found for session ${sessionId}`)
      }
      return
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

// Poll watched sessions for pending permissions (file-based detection)
setInterval(() => {
  for (const [sessionId, { projectPath, lastPendingIds }] of watchedSessions) {
    // Skip if there's already an active process for this session
    if (activeProcesses.has(sessionId)) continue

    // Skip if we're currently approving a permission for this session
    if (sessionsBeingApproved.has(sessionId)) continue

    const pending = getPendingToolCalls(projectPath, sessionId)

    for (const tool of pending) {
      // Skip if we already broadcast this one
      if (lastPendingIds.has(tool.id)) continue

      // Check if tool is already allowed
      const allowedTools = allowedToolsBySession.get(sessionId)
      if (allowedTools?.has(tool.name)) {
        console.log(`[server] Auto-approving file-detected ${tool.name} (allowed for session)`)
        // Spawn Claude to approve this tool
        approveToolViaResume(sessionId, projectPath, tool)
        lastPendingIds.add(tool.id)
        continue
      }

      console.log(`[server] File-detected pending permission: ${tool.name} (${tool.id})`)
      lastPendingIds.add(tool.id)
      pendingFilePermissions.set(tool.id, tool)

      // Broadcast to web clients
      ws.broadcast({
        type: 'permission_request',
        sessionId,
        requestId: tool.id,
        toolName: tool.name,
        toolUseId: tool.id,
        input: tool.input as Record<string, unknown>,
        source: 'file' // Indicate this came from file detection, not active process
      })
    }
  }
}, 1000) // Check every second

// Helper to approve a tool by spawning Claude with --resume
function approveToolViaResume(sessionId: string, projectPath: string, tool: PendingToolCall) {
  console.log(`[server] Approving ${tool.name} (id=${tool.id}) via resume for session ${sessionId}`)
  console.log(`[server] Tool input: ${JSON.stringify(tool.input).slice(0, 200)}`)

  // Mark session as being approved to prevent re-detection during approval
  sessionsBeingApproved.add(sessionId)

  const claude = spawnClaude({
    cwd: projectPath,
    resume: sessionId,
    onMessage: (msg) => {
      console.log(`[server] Resume approval got message type=${msg.type}: ${JSON.stringify(msg).slice(0, 300)}`)
      ws.broadcast({ type: 'claude_message', message: msg, sessionId })
    },
    onPermissionRequest: (permReq) => {
      // Auto-approve any permission request that comes through
      console.log(`[server] Resume approval: got permission request for ${permReq.toolName} (requestId=${permReq.requestId})`)
      console.log(`[server] Resume approval: auto-approving...`)
      claude.sendPermissionResponse(permReq.requestId, true, permReq.input)
    }
  })

  // Log raw stdout/stderr for debugging
  claude.child.stdout?.on('data', (data: Buffer) => {
    const str = data.toString()
    if (!str.includes('"type"')) { // Don't log JSON messages twice
      console.log(`[server] Resume stdout (raw): ${str.slice(0, 200)}`)
    }
  })

  claude.child.stderr?.on('data', (data: Buffer) => {
    console.log(`[server] Resume stderr: ${data.toString()}`)
  })

  // Send a nudge message to trigger Claude to continue
  // This might help if Claude is waiting for input after resume
  setTimeout(() => {
    console.log(`[server] Sending continue nudge to resumed Claude`)
    claude.send('continue')
  }, 1000)

  claude.onExit((code) => {
    console.log(`[server] Resume approval process exited for ${sessionId} with code ${code}`)
    sessionsBeingApproved.delete(sessionId)
  })

  // Timeout after 30 seconds
  setTimeout(() => {
    console.log(`[server] Resume approval timeout - killing process`)
    sessionsBeingApproved.delete(sessionId)
    claude.child.kill()
  }, 30000)
}

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
