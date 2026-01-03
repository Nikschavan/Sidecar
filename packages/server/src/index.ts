/**
 * Sidecar Server
 *
 * Main entry point - HTTP + WebSocket server for Claude sessions
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createWSServer, type WSClient } from './ws/server.js'
import { createSessionManager } from './session/manager.js'
import { listClaudeSessions, readClaudeSession, getMostRecentSession, listAllProjects, findSessionProject, readSessionData, getSessionMetadata, isSessionActive, type PendingToolCall } from './claude/sessions.js'
import { spawnClaude, type ClaudeProcess, type PermissionRequest } from './claude/spawn.js'
import { setupClaudeHooks, removeClaudeHooks } from './claude/hooks.js'
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

// Track which sessions clients are watching (for file-based permission detection and message updates)
const watchedSessions = new Map<string, { projectPath: string; lastPendingIds: Set<string>; lastMessageCount: number }>()

// Track client-session watching relationships for proper cleanup
const clientWatchingSession = new Map<string, string>() // clientId -> sessionId
const sessionWatchers = new Map<string, Set<string>>() // sessionId -> Set<clientId>

// Track pending hook-based permissions for re-sending on page reload
// Maps sessionId -> hook notification data with tool details
interface PendingHookPermission {
  sessionId: string
  message: string
  timestamp: number
  toolName: string
  toolUseId: string
  toolInput: Record<string, unknown>
}
const pendingHookPermissions = new Map<string, PendingHookPermission>()

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
        size: s.size,
        model: s.model
      }))
    }))
    return
  }

  // Create a new Claude session for a project
  const newSessionMatch = url.pathname.match(/^\/api\/claude\/projects\/(.+)\/new$/)
  if (newSessionMatch && req.method === 'POST') {
    const projectPath = decodeURIComponent(newSessionMatch[1])
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }
    const { text, images, permissionMode, model } = JSON.parse(body || '{}')
    if (!text && (!images || images.length === 0)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'text or images required' }))
      return
    }

    console.log(`[server] Creating new Claude session in ${projectPath}: ${(text || '').slice(0, 50)}...`)
    console.log(`[server] NEW SESSION ENDPOINT HIT - timestamp: ${Date.now()}`)
    console.log(`[server] Settings: permissionMode=${permissionMode || 'default'}, model=${model || 'default'}, images=${images?.length || 0}`)

    // Spawn Claude WITHOUT --resume to create a new session
    const responses: unknown[] = []
    let newSessionId: string | null = null
    let responseSent = false

    // Promise to wait for session ID
    let resolveSessionId: (id: string) => void
    let rejectSessionId: (err: Error) => void
    const sessionIdPromise = new Promise<string>((resolve, reject) => {
      resolveSessionId = resolve
      rejectSessionId = reject
    })

    const claude = spawnClaude({
      cwd: projectPath,
      permissionMode,
      model,
      // No resume - creates new session
      onSessionId: (id) => {
        newSessionId = id
        console.log(`[server] New session created: ${id}`)
        resolveSessionId(id)
      },
      onMessage: (msg) => {
        responses.push(msg)
        // Broadcast to WebSocket clients
        if (newSessionId) {
          ws.broadcast({ type: 'claude_message', message: msg, sessionId: newSessionId })
        }
      },
      onPermissionRequest: (permReq) => {
        console.log(`[server] Permission request for ${permReq.toolName}`)

        // Broadcast permission request
        if (newSessionId) {
          ws.broadcast({
            type: 'permission_request',
            sessionId: newSessionId,
            requestId: permReq.requestId,
            toolName: permReq.toolName,
            toolUseId: permReq.toolUseId,
            input: permReq.input,
            permissionSuggestions: permReq.permissionSuggestions
          })

          // Store process for permission responses
          activeProcesses.set(newSessionId, {
            claude,
            sessionId: newSessionId,
            projectPath,
            pendingPermission: permReq,
            responses,
            resolve: () => {}
          })
        }
      }
    })

    // Send the initial message with optional images
    claude.send(text || '', images)

    // Handle cleanup when Claude finishes
    let finished = false
    const cleanup = () => {
      if (!finished) {
        finished = true
        if (newSessionId) {
          activeProcesses.delete(newSessionId)
        }
      }
    }

    claude.onMessage((msg) => {
      if (msg.type === 'result') {
        cleanup()
      }
    })

    claude.onExit(() => {
      cleanup()
      if (!responseSent) {
        rejectSessionId(new Error('Claude exited before providing session ID'))
      }
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!finished) {
        cleanup()
        claude.child.kill()
      }
    }, 300000)

    // Wait only for the session ID, not for completion
    console.log(`[server] Waiting for session ID...`)
    try {
      const sessionId = await Promise.race([
        sessionIdPromise,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for session ID')), 10000)
        )
      ])

      console.log(`[server] Got session ID: ${sessionId}, returning response NOW`)
      responseSent = true
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        sessionId,
        projectPath
      }))
    } catch (err) {
      console.log(`[server] Error waiting for session ID: ${(err as Error).message}`)
      responseSent = true
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Failed to create session - ' + (err as Error).message }))
    }
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
    // Check if session is actively being processed (file modified recently or has active process)
    const hasActiveProcess = activeProcesses.has(sessionId)
    const fileIsActive = isSessionActive(projectPath, sessionId, 5) // 5 second threshold
    const isActive = hasActiveProcess || fileIsActive
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      sessionId,
      projectPath,
      messageCount: messages.length,
      messages,
      isActive
    }))
    return
  }

  // Get session metadata (model, etc.)
  const metadataMatch = url.pathname.match(/^\/api\/claude\/sessions\/([^/]+)\/metadata$/)
  if (metadataMatch && req.method === 'GET') {
    const sessionId = metadataMatch[1]
    const projectPath = findSessionProject(sessionId)
    if (!projectPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }
    const metadata = getSessionMetadata(projectPath, sessionId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ sessionId, ...metadata }))
    return
  }

  // Get available slash commands for a session
  const slashCommandsMatch = url.pathname.match(/^\/api\/claude\/sessions\/([^/]+)\/commands$/)
  if (slashCommandsMatch && req.method === 'GET') {
    // For now, return default commands. In future, could parse from session or query Claude
    const defaultCommands = [
      { command: '/help', description: 'Show help and available commands' },
      { command: '/clear', description: 'Clear conversation history' },
      { command: '/compact', description: 'Compact conversation to save context' },
      { command: '/config', description: 'Open configuration' },
      { command: '/cost', description: 'Show token usage and cost' },
      { command: '/doctor', description: 'Check Claude Code health' },
      { command: '/init', description: 'Initialize project with CLAUDE.md' },
      { command: '/memory', description: 'Edit CLAUDE.md memory file' },
      { command: '/model', description: 'Select AI model' },
      { command: '/review', description: 'Review code changes' },
      { command: '/status', description: 'Show session status' },
      { command: '/vim', description: 'Toggle vim mode' },
    ]
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ commands: defaultCommands }))
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
    const { text, images, permissionMode, model } = JSON.parse(body || '{}')
    if (!text && (!images || images.length === 0)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'text or images required' }))
      return
    }

    // Find the project this session belongs to
    const projectPath = findSessionProject(sessionId)
    if (!projectPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found in any project' }))
      return
    }

    console.log(`[server] Sending to Claude session ${sessionId} in ${projectPath}: ${(text || '').slice(0, 50)}...`)
    console.log(`[server] Settings: permissionMode=${permissionMode || 'default'}, model=${model || 'default'}, images=${images?.length || 0}`)

    // Spawn Claude with --resume to continue the session
    const responses: unknown[] = []
    let pendingPermission: PermissionRequest | null = null

    const claude = spawnClaude({
      cwd: projectPath,
      resume: sessionId,
      permissionMode,
      model,
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

    // Send the message with optional images
    claude.send(text || '', images)

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
        ws.broadcast({ type: 'claude_message', message: msg, sessionId })
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

  // Handle Claude Code hook notifications (from notification hooks)
  if (url.pathname === '/api/claude-hook' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }
    try {
      const hookData = JSON.parse(body || '{}')
      const { session_id, notification_type, message, transcript_path, cwd } = hookData
      console.log(`[server] Hook notification: ${notification_type} for session ${session_id}`)

      if (notification_type === 'permission_prompt') {
        const hookId = `hook-${session_id}`

        // Try to get detailed tool info from the session file
        let toolName = 'Permission Required'
        let toolInput: Record<string, unknown> = { message }
        let toolUseId = hookId

        if (cwd && session_id) {
          try {
            // Read session data to get the actual pending tool call
            const sessionData = readSessionData(cwd, session_id)
            if (sessionData.pendingToolCalls.length > 0) {
              // Get the most recent pending tool (likely the one needing permission)
              const pendingTool = sessionData.pendingToolCalls[sessionData.pendingToolCalls.length - 1]
              toolName = pendingTool.name
              toolInput = pendingTool.input as Record<string, unknown>
              toolUseId = pendingTool.id
              console.log(`[server] Found pending tool: ${toolName} (${toolUseId})`)
            }
          } catch (err) {
            console.log(`[server] Could not read session data: ${(err as Error).message}`)
            // Fall back to hook message
          }
        }

        // Track the permission for re-sending on page reload
        pendingHookPermissions.set(session_id, {
          sessionId: session_id,
          message,
          timestamp: Date.now(),
          toolName,
          toolUseId,
          toolInput
        })

        // Log watchers for debugging
        const watchers = sessionWatchers.get(session_id)
        console.log(`[server] Broadcasting permission_request:`)
        console.log(`[server]   Session ID: ${session_id}`)
        console.log(`[server]   Tool: ${toolName}`)
        console.log(`[server]   Tool ID: ${toolUseId}`)
        console.log(`[server]   Watchers: ${watchers?.size || 0}`)
        console.log(`[server]   All watched sessions: ${[...watchedSessions.keys()].join(', ') || '(none)'}`)

        // Broadcast to web clients watching this session
        ws.broadcast({
          type: 'permission_request',
          sessionId: session_id,
          toolName,
          toolUseId,
          requestId: toolUseId,
          input: toolInput,
          source: 'hook'
        })
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      console.error(`[server] Failed to parse hook data: ${(err as Error).message}`)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON' }))
    }
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
        // If client was watching a different session, unwatch it first
        const previousSessionId = clientWatchingSession.get(client.id)
        if (previousSessionId && previousSessionId !== sessionId) {
          const watchers = sessionWatchers.get(previousSessionId)
          if (watchers) {
            watchers.delete(client.id)
            // If no more watchers, stop watching this session
            if (watchers.size === 0) {
              console.log(`[server] No more watchers for session ${previousSessionId}, stopping watch`)
              watchedSessions.delete(previousSessionId)
              sessionWatchers.delete(previousSessionId)
            }
          }
        }

        // Track this client watching this session
        clientWatchingSession.set(client.id, sessionId)
        if (!sessionWatchers.has(sessionId)) {
          sessionWatchers.set(sessionId, new Set())
        }
        sessionWatchers.get(sessionId)!.add(client.id)

        // Don't reset if already watching - preserve lastPendingIds
        if (!watchedSessions.has(sessionId)) {
          console.log(`[server] Client ${client.id} watching session ${sessionId}`)
          // Get initial data
          const sessionData = readSessionData(projectPath, sessionId)

          // Check if this session is actively being used (file modified recently)
          // Use 30 second threshold to be lenient - if file was modified in last 30s, consider it active
          const sessionIsActive = isSessionActive(projectPath, sessionId, 30)

          // For stale sessions, pre-populate lastPendingIds with existing pending tools
          // This prevents showing permission modals for old/abandoned sessions
          const initialPendingIds = new Set<string>()
          if (!sessionIsActive) {
            for (const tool of sessionData.pendingToolCalls) {
              initialPendingIds.add(tool.id)
            }
            console.log(`[server] Session ${sessionId} is stale, pre-populating ${initialPendingIds.size} pending tool IDs`)
          } else {
            console.log(`[server] Session ${sessionId} is active (recently modified)`)
          }

          watchedSessions.set(sessionId, {
            projectPath,
            lastPendingIds: initialPendingIds,
            lastMessageCount: sessionData.messages.length
          })
        } else {
          console.log(`[server] Client ${client.id} joining watch for session ${sessionId} (${sessionWatchers.get(sessionId)?.size} watchers)`)
        }

        // Re-send any pending hook-based permissions for this session (handles page reload)
        const pendingHook = pendingHookPermissions.get(sessionId)
        if (pendingHook) {
          // Only re-send if permission is recent (within last 5 minutes)
          const ageMs = Date.now() - pendingHook.timestamp
          if (ageMs < 300000) {
            console.log(`[server] Re-sending pending hook permission for session ${sessionId}: ${pendingHook.toolName}`)
            client.send({
              type: 'permission_request',
              sessionId,
              toolName: pendingHook.toolName,
              toolUseId: pendingHook.toolUseId,
              requestId: pendingHook.toolUseId,
              input: pendingHook.toolInput,
              source: 'hook'
            })
          } else {
            // Permission too old, remove it
            pendingHookPermissions.delete(sessionId)
          }
        }
      }
      return
    }

    // Handle abort request from web client (like Ctrl+C)
    if (message.type === 'abort_session') {
      const { sessionId } = message as { sessionId: string }
      console.log(`[server] Abort request for session ${sessionId}`)

      // Kill active process if exists
      const activeProcess = activeProcesses.get(sessionId)
      if (activeProcess) {
        console.log(`[server] Killing active Claude process for session ${sessionId}`)
        activeProcess.claude.child.kill('SIGINT') // Send Ctrl+C signal
        activeProcesses.delete(sessionId)
        activeProcess.resolve()

        // Broadcast abort confirmation
        ws.broadcast({
          type: 'session_aborted',
          sessionId
        })
      } else {
        console.log(`[server] No active process found for session ${sessionId}`)
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

      // Note: File-based permission responses are no longer supported since
      // permission detection moved to Claude Code notification hooks.
      // Hooks only notify of permissions; users must respond in terminal.
      // This section handles active process permissions (spawned by Sidecar).

      // Handle active process permission
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

    // Clean up session watching
    const sessionId = clientWatchingSession.get(client.id)
    if (sessionId) {
      clientWatchingSession.delete(client.id)
      const watchers = sessionWatchers.get(sessionId)
      if (watchers) {
        watchers.delete(client.id)
        // If no more watchers, stop watching this session
        if (watchers.size === 0) {
          console.log(`[server] No more watchers for session ${sessionId}, stopping watch`)
          watchedSessions.delete(sessionId)
          sessionWatchers.delete(sessionId)
        } else {
          console.log(`[server] Client disconnected, ${watchers.size} watchers remaining for session ${sessionId}`)
        }
      }
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
  ws.broadcast({ type: 'message', message, sessionId })
})

sessionManager.onStateChange((sessionId, state) => {
  ws.broadcast({ type: 'state_change', state, sessionId })
})

sessionManager.onSessionReady((sessionId, claudeSessionId) => {
  console.log(`[server] Session ${sessionId} ready with Claude session ${claudeSessionId}`)
})

// Poll watched sessions for pending permissions and new messages (file-based detection)
// Uses readSessionData() to read file once for both messages and permissions
setInterval(() => {
  for (const [sessionId, watchedSession] of watchedSessions) {
    const { projectPath, lastPendingIds } = watchedSession

    // Read session data once (messages + pending tool calls)
    let sessionData
    try {
      sessionData = readSessionData(projectPath, sessionId)
    } catch (e) {
      continue // Skip this session if file can't be read
    }

    // Check for new messages (from terminal CLI)
    if (sessionData.messages.length > watchedSession.lastMessageCount) {
      const newMessages = sessionData.messages.slice(watchedSession.lastMessageCount)
      for (const message of newMessages) {
        ws.broadcast({ type: 'claude_message', message, sessionId })
      }
      watchedSession.lastMessageCount = sessionData.messages.length
    }

    // Check if the specific pending hook permission is now resolved
    // This clears the hook-based permission when user accepts in terminal
    const currentPendingIds = new Set(sessionData.pendingToolCalls.map(t => t.id))
    const pendingHook = pendingHookPermissions.get(sessionId)

    if (pendingHook) {
      // Check if the specific tool we're tracking is no longer pending
      const toolStillPending = currentPendingIds.has(pendingHook.toolUseId)
      if (!toolStillPending) {
        console.log(`[server] Permission resolved in terminal for session ${sessionId} (tool ${pendingHook.toolUseId} no longer pending)`)
        pendingHookPermissions.delete(sessionId)
        // Broadcast to web clients to clear the modal
        ws.broadcast({
          type: 'permission_resolved',
          sessionId,
          toolId: pendingHook.toolUseId
        })
      }
    }

    // Note: File-based permission DETECTION has been removed.
    // Permission detection is now handled by Claude Code notification hooks
    // which call the /api/claude-hook endpoint.
    // This avoids false positives for auto-executing tools like Task.

    // Track all current pending IDs to support resolution detection above
    for (const tool of sessionData.pendingToolCalls) {
      lastPendingIds.add(tool.id)
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
  // Configure Claude Code notification hooks to forward to this server
  setupClaudeHooks(PORT)

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

// Graceful shutdown - remove hooks from Claude settings
function shutdown(signal: string) {
  console.log(`\n[server] Received ${signal}, shutting down...`)
  removeClaudeHooks()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
