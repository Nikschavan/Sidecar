/**
 * Claude Routes
 *
 * All /api/claude/* endpoints
 */

import { Hono } from 'hono'
import {
  listAllProjects,
  listClaudeSessions,
  readClaudeSession,
  getMostRecentSession,
  findSessionProject,
  getSessionMetadata,
  isSessionActive,
  readSessionData,
  getSessionMessageCount
} from '../claude/sessions.js'
import { claudeService } from '../services/claude.service.js'

const CWD = process.cwd()

export const claudeRoutes = new Hono()

// List all projects
claudeRoutes.get('/projects', (c) => {
  const projects = listAllProjects()
  return c.json({
    projects: projects.map((p) => ({
      path: p.path,
      name: p.path.split('/').pop() || p.path,
      modifiedAt: p.modifiedAt.toISOString()
    }))
  })
})

// List Claude sessions for a specific project (by encoded path)
claudeRoutes.get('/projects/:projectPath/sessions', (c) => {
  const projectPath = decodeURIComponent(c.req.param('projectPath'))
  const sessions = listClaudeSessions(projectPath)
  return c.json({
    projectPath,
    sessions: sessions.map((s) => ({
      id: s.id,
      name: s.name,
      modifiedAt: s.modifiedAt.toISOString(),
      size: s.size,
      model: s.model
    }))
  })
})

// Create a new Claude session for a project
claudeRoutes.post('/projects/:projectPath/new', async (c) => {
  const projectPath = decodeURIComponent(c.req.param('projectPath'))
  const body = await c.req.json().catch(() => ({}))
  const { text, images, permissionMode, model } = body

  if (!text && (!images || images.length === 0)) {
    return c.json({ error: 'text or images required' }, 400)
  }

  console.log(`[claude.routes] Creating new session in ${projectPath}: ${(text || '').slice(0, 50)}...`)

  try {
    const result = await claudeService.createSession(projectPath, text || '', {
      images,
      permissionMode,
      model
    })
    return c.json(result)
  } catch (err) {
    console.error(`[claude.routes] Failed to create session: ${(err as Error).message}`)
    return c.json({ error: 'Failed to create session - ' + (err as Error).message }, 500)
  }
})

// List Claude sessions (read directly from Claude's files)
claudeRoutes.get('/sessions', (c) => {
  const sessions = listClaudeSessions(CWD)
  const recentId = getMostRecentSession(CWD)
  return c.json({
    cwd: CWD,
    mostRecent: recentId,
    sessions: sessions.map((s) => ({
      id: s.id,
      name: s.name,
      modifiedAt: s.modifiedAt.toISOString(),
      size: s.size
    }))
  })
})

// Get Claude session messages (auto-finds project)
claudeRoutes.get('/sessions/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId')
  const limitParam = c.req.query('limit')
  const offsetParam = c.req.query('offset')
  const limit = limitParam ? parseInt(limitParam, 10) : 50 // Default to 50 messages
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0 // Default to 0 (most recent)

  const projectPath = findSessionProject(sessionId) || CWD
  const totalMessages = getSessionMessageCount(projectPath, sessionId)
  const messages = readClaudeSession(projectPath, sessionId, {
    limit: limit > 0 ? limit : undefined,
    offset,
    fromEnd: true  // Always get most recent messages
  })

  const hasActiveProcess = !!claudeService.getActiveProcess(sessionId)
  const fileIsActive = isSessionActive(projectPath, sessionId, 5)
  const isActive = hasActiveProcess || fileIsActive

  return c.json({
    sessionId,
    projectPath,
    messageCount: messages.length,
    totalMessages,  // Total available messages
    offset,         // Current offset (for frontend to track position)
    messages,
    isActive,
    isPartial: limit > 0  // Indicate if this is a partial response
  })
})

// Get session metadata (model, etc.)
claudeRoutes.get('/sessions/:sessionId/metadata', (c) => {
  const sessionId = c.req.param('sessionId')
  const projectPath = findSessionProject(sessionId)

  if (!projectPath) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const metadata = getSessionMetadata(projectPath, sessionId)
  return c.json({ sessionId, ...metadata })
})

// Get available slash commands for a session
claudeRoutes.get('/sessions/:sessionId/commands', (c) => {
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
  return c.json({ commands: defaultCommands })
})

// Get most recent Claude session
claudeRoutes.get('/current', (c) => {
  const sessionId = getMostRecentSession(CWD)
  if (!sessionId) {
    return c.json({ error: 'No Claude sessions found' }, 404)
  }

  const limitParam = c.req.query('limit')
  const offsetParam = c.req.query('offset')
  const limit = limitParam ? parseInt(limitParam, 10) : 50 // Default to 50 messages
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0 // Default to 0 (most recent)

  const totalMessages = getSessionMessageCount(CWD, sessionId)
  const messages = readClaudeSession(CWD, sessionId, {
    limit: limit > 0 ? limit : undefined,
    offset,
    fromEnd: true
  })

  return c.json({
    sessionId,
    cwd: CWD,
    messageCount: messages.length,
    totalMessages,
    offset,
    messages,
    isPartial: limit > 0
  })
})

// Send message to Claude session (spawns new Claude process with --resume)
claudeRoutes.post('/sessions/:sessionId/send', async (c) => {
  const sessionId = c.req.param('sessionId')
  const body = await c.req.json().catch(() => ({}))
  const { text, images, permissionMode, model } = body

  if (!text && (!images || images.length === 0)) {
    return c.json({ error: 'text or images required' }, 400)
  }

  console.log(`[claude.routes] Sending to session ${sessionId}: ${(text || '').slice(0, 50)}...`)

  try {
    const result = await claudeService.sendMessage(sessionId, text || '', {
      images,
      permissionMode,
      model
    })
    return c.json({
      sessionId: result.sessionId,
      messageCount: result.responses.length,
      responses: result.responses
    })
  } catch (err) {
    console.error(`[claude.routes] Failed to send message: ${(err as Error).message}`)
    return c.json({ error: (err as Error).message }, 404)
  }
})

// Respond to permission request for a session
claudeRoutes.post('/sessions/:sessionId/permission', async (c) => {
  const sessionId = c.req.param('sessionId')
  const body = await c.req.json().catch(() => ({}))
  const { requestId, allow, allowAll, toolName, updatedInput, answer } = body

  const pendingPermission = claudeService.getPendingPermission(sessionId)
  const reqId = requestId || pendingPermission?.requestId

  if (!reqId) {
    return c.json({ error: 'No pending permission request' }, 400)
  }

  const success = claudeService.respondToPermission(sessionId, reqId, allow, {
    allowAll,
    toolName,
    updatedInput,
    answer  // For AskUserQuestion: the user's selected answer
  })
  if (!success) {
    return c.json({ error: 'No active process waiting for permission' }, 404)
  }

  return c.json({ ok: true, requestId: reqId, allow })
})

// Check if session has pending permission
claudeRoutes.get('/sessions/:sessionId/permission', (c) => {
  const sessionId = c.req.param('sessionId')
  const permission = claudeService.getPendingPermission(sessionId)

  return c.json({
    sessionId,
    hasPendingPermission: !!permission,
    permission
  })
})

// Send message to most recent Claude session
claudeRoutes.post('/send', async (c) => {
  const sessionId = getMostRecentSession(CWD)
  if (!sessionId) {
    return c.json({ error: 'No Claude sessions found. Start a claude session first.' }, 404)
  }

  const body = await c.req.json().catch(() => ({}))
  const { text } = body

  if (!text) {
    return c.json({ error: 'text is required' }, 400)
  }

  console.log(`[claude.routes] Sending to most recent session ${sessionId}: ${text.slice(0, 50)}...`)

  try {
    const result = await claudeService.sendMessage(sessionId, text)
    return c.json({
      sessionId: result.sessionId,
      messageCount: result.responses.length,
      responses: result.responses
    })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }
})

// Handle Claude Code hook notifications (from notification hooks)
claudeRoutes.post('/claude-hook', async (c) => {
  try {
    const hookData = await c.req.json()
    const { session_id, notification_type, message, cwd } = hookData

    claudeService.handleHookNotification(session_id, notification_type, message, cwd)

    return c.json({ ok: true })
  } catch (err) {
    console.error(`[claude.routes] Failed to parse hook data: ${(err as Error).message}`)
    return c.json({ error: 'Invalid JSON' }, 400)
  }
})
