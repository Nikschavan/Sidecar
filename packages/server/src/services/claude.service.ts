/**
 * Claude Service
 *
 * Manages Claude processes, permissions, and session watching
 */

import { execSync } from 'node:child_process'
import { spawnClaude, type ClaudeProcess, type PermissionRequest } from '../claude/spawn.js'
import {
  findSessionProject,
  readSessionData,
  isSessionActive,
  type PendingToolCall
} from '../claude/sessions.js'
import type { ImageBlock } from '@sidecar/shared'

/**
 * Active Claude process with associated state
 */
export interface ActiveProcess {
  claude: ClaudeProcess
  sessionId: string
  projectPath: string
  pendingPermission: PermissionRequest | null
  responses: unknown[]
  resolve: () => void
}

/**
 * Pending hook-based permission
 */
export interface PendingHookPermission {
  sessionId: string
  message: string
  timestamp: number
  toolName: string
  toolUseId: string
  toolInput: Record<string, unknown>
}

/**
 * Watched session state
 */
export interface WatchedSession {
  projectPath: string
  lastPendingIds: Set<string>
  lastMessageCount: number
}

/**
 * Event handler types
 */
export type MessageHandler = (sessionId: string, message: unknown) => void
export type PermissionHandler = (sessionId: string, permission: {
  toolName: string
  toolUseId: string
  requestId: string
  input: Record<string, unknown>
  source: 'hook' | 'file' | 'process'
  permissionSuggestions?: PermissionRequest['permissionSuggestions']
}) => void
export type PermissionResolvedHandler = (sessionId: string, toolId: string) => void

/**
 * Claude Service - manages Claude processes and permissions
 */
export class ClaudeService {
  // Track active Claude processes waiting for permission
  private activeProcesses = new Map<string, ActiveProcess>()

  // Track allowed tools per session (when user clicks "Allow All")
  private allowedToolsBySession = new Map<string, Set<string>>()

  // Track watched sessions for file-based detection
  private watchedSessions = new Map<string, WatchedSession>()

  // Track client-session watching relationships
  private clientWatchingSession = new Map<string, string>()
  private sessionWatchers = new Map<string, Set<string>>()

  // Track pending hook-based permissions
  private pendingHookPermissions = new Map<string, PendingHookPermission>()

  // Track pending AskUserQuestion tools
  private pendingAskUserQuestions = new Map<string, { tool: PendingToolCall; sessionId: string }>()

  // Track sessions being approved via resume
  private sessionsBeingApproved = new Set<string>()

  // Track permission timeouts (requestId -> timeout handle)
  private permissionTimeouts = new Map<string, NodeJS.Timeout>()

  // Permission timeout in milliseconds (60 seconds)
  private static readonly PERMISSION_TIMEOUT_MS = 60000

  // Event handlers
  private messageHandlers: MessageHandler[] = []
  private permissionHandlers: PermissionHandler[] = []
  private permissionResolvedHandlers: PermissionResolvedHandler[] = []
  private permissionTimeoutHandlers: Array<(sessionId: string, requestId: string, toolName: string) => void> = []

  /**
   * Kill any orphaned Claude processes from previous Sidecar runs
   * Called on startup to clean up processes that may be stuck waiting for permissions
   */
  killOrphanedProcesses(): void {
    try {
      // Find Claude processes with --permission-prompt-tool stdio (spawned by Sidecar)
      const result = execSync(
        'pgrep -f "claude.*--permission-prompt-tool stdio" || true',
        { encoding: 'utf-8' }
      ).trim()

      if (result) {
        const pids = result.split('\n').filter(Boolean)
        console.log(`[ClaudeService] Found ${pids.length} orphaned Claude process(es), killing...`)
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid, 10), 'SIGTERM')
            console.log(`[ClaudeService] Killed orphaned process ${pid}`)
          } catch (err) {
            // Process may have already exited
            console.log(`[ClaudeService] Could not kill process ${pid}: ${(err as Error).message}`)
          }
        }
      }
    } catch (err) {
      console.log(`[ClaudeService] Error checking for orphaned processes: ${(err as Error).message}`)
    }
  }

  /**
   * Register a permission timeout handler
   */
  onPermissionTimeout(handler: (sessionId: string, requestId: string, toolName: string) => void): void {
    this.permissionTimeoutHandlers.push(handler)
  }

  /**
   * Emit a permission timeout event
   */
  private emitPermissionTimeout(sessionId: string, requestId: string, toolName: string): void {
    for (const handler of this.permissionTimeoutHandlers) {
      handler(sessionId, requestId, toolName)
    }
  }

  /**
   * Start a timeout for a permission request
   * For spawned processes: kills the process after timeout
   * For hook-based permissions: keeps pending for re-display
   */
  private startPermissionTimeout(sessionId: string, requestId: string, toolName: string): void {
    // Clear any existing timeout for this request
    this.clearPermissionTimeout(requestId)

    const timeout = setTimeout(() => {
      console.log(`[ClaudeService] Permission timeout for ${toolName} (${requestId})`)
      this.permissionTimeouts.delete(requestId)

      const activeProcess = this.activeProcesses.get(sessionId)
      if (activeProcess) {
        // Spawned process - kill it to stop the stuck process
        console.log(`[ClaudeService] Killing timed-out spawned process for session ${sessionId}`)
        activeProcess.claude.child.kill('SIGTERM')
        this.activeProcesses.delete(sessionId)
        this.emitPermissionTimeout(sessionId, requestId, toolName)
      } else {
        // Hook-based permission - keep it pending for re-display when user opens session
        console.log(`[ClaudeService] Hook permission timeout - keeping pending for re-display`)
        this.emitPermissionTimeout(sessionId, requestId, toolName)
      }
    }, ClaudeService.PERMISSION_TIMEOUT_MS)

    this.permissionTimeouts.set(requestId, timeout)
  }

  /**
   * Clear a permission timeout
   */
  private clearPermissionTimeout(requestId: string): void {
    const timeout = this.permissionTimeouts.get(requestId)
    if (timeout) {
      clearTimeout(timeout)
      this.permissionTimeouts.delete(requestId)
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  /**
   * Register a permission request handler
   */
  onPermissionRequest(handler: PermissionHandler): void {
    this.permissionHandlers.push(handler)
  }

  /**
   * Register a permission resolved handler
   */
  onPermissionResolved(handler: PermissionResolvedHandler): void {
    this.permissionResolvedHandlers.push(handler)
  }

  /**
   * Emit a message event
   */
  private emitMessage(sessionId: string, message: unknown): void {
    for (const handler of this.messageHandlers) {
      handler(sessionId, message)
    }
  }

  /**
   * Emit a permission request event
   */
  private emitPermissionRequest(sessionId: string, permission: Parameters<PermissionHandler>[1]): void {
    // Start timeout for this permission request
    this.startPermissionTimeout(sessionId, permission.requestId, permission.toolName)

    for (const handler of this.permissionHandlers) {
      handler(sessionId, permission)
    }
  }

  /**
   * Emit a permission resolved event
   */
  private emitPermissionResolved(sessionId: string, toolId: string): void {
    for (const handler of this.permissionResolvedHandlers) {
      handler(sessionId, toolId)
    }
  }

  /**
   * Create a new Claude session
   */
  async createSession(
    projectPath: string,
    text: string,
    options: {
      images?: ImageBlock[]
      permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'plan'
      model?: 'sonnet' | 'opus' | 'default'
    } = {}
  ): Promise<{ sessionId: string; projectPath: string }> {
    console.log(`[ClaudeService] Creating new session in ${projectPath}: ${text.slice(0, 50)}...`)

    const responses: unknown[] = []
    let newSessionId: string | null = null

    return new Promise((resolve, reject) => {
      const claude = spawnClaude({
        cwd: projectPath,
        permissionMode: options.permissionMode,
        model: options.model,
        onSessionId: (id) => {
          newSessionId = id
          console.log(`[ClaudeService] New session created: ${id}`)
          resolve({ sessionId: id, projectPath })
        },
        onMessage: (msg) => {
          responses.push(msg)
          if (newSessionId) {
            this.emitMessage(newSessionId, msg)
          }
        },
        onPermissionRequest: (permReq) => {
          console.log(`[ClaudeService] Permission request for ${permReq.toolName}`)
          if (newSessionId) {
            this.emitPermissionRequest(newSessionId, {
              toolName: permReq.toolName,
              toolUseId: permReq.toolUseId,
              requestId: permReq.requestId,
              input: permReq.input,
              source: 'process',
              permissionSuggestions: permReq.permissionSuggestions
            })
            this.activeProcesses.set(newSessionId, {
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

      claude.send(text, options.images)

      // Cleanup on exit
      claude.onExit(() => {
        if (newSessionId) {
          this.activeProcesses.delete(newSessionId)
        }
        if (!newSessionId) {
          reject(new Error('Claude exited before providing session ID'))
        }
      })

      // Timeout
      setTimeout(() => {
        if (!newSessionId) {
          claude.child.kill()
          reject(new Error('Timeout waiting for session ID'))
        }
      }, 10000)
    })
  }

  /**
   * Send a message to an existing session (resumes it)
   */
  async sendMessage(
    sessionId: string,
    text: string,
    options: {
      images?: ImageBlock[]
      permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'plan'
      model?: 'sonnet' | 'opus' | 'default'
    } = {}
  ): Promise<{ sessionId: string; responses: unknown[] }> {
    const projectPath = findSessionProject(sessionId)
    if (!projectPath) {
      throw new Error('Session not found in any project')
    }

    console.log(`[ClaudeService] Sending to session ${sessionId}: ${text.slice(0, 50)}...`)

    const responses: unknown[] = []
    let pendingPermission: PermissionRequest | null = null

    return new Promise((resolve) => {
      let finished = false
      let resolvePromise: () => void

      const claude = spawnClaude({
        cwd: projectPath,
        resume: sessionId,
        permissionMode: options.permissionMode,
        model: options.model,
        onMessage: (msg) => {
          responses.push(msg)
          this.emitMessage(sessionId, msg)
        },
        onPermissionRequest: (permReq) => {
          console.log(`[ClaudeService] Permission request for ${permReq.toolName}`)

          // Check if tool is already allowed
          const allowedTools = this.allowedToolsBySession.get(sessionId)
          if (allowedTools?.has(permReq.toolName)) {
            console.log(`[ClaudeService] Auto-approving ${permReq.toolName}`)
            claude.sendPermissionResponse(permReq.requestId, true, permReq.input)
            return
          }

          pendingPermission = permReq
          const proc = this.activeProcesses.get(sessionId)
          if (proc) {
            proc.pendingPermission = permReq
          }

          this.emitPermissionRequest(sessionId, {
            toolName: permReq.toolName,
            toolUseId: permReq.toolUseId,
            requestId: permReq.requestId,
            input: permReq.input,
            source: 'process',
            permissionSuggestions: permReq.permissionSuggestions
          })
        }
      })

      claude.send(text, options.images)

      const donePromise = new Promise<void>((res) => {
        resolvePromise = res
      })

      claude.onMessage((msg) => {
        if (msg.type === 'result' && !finished) {
          finished = true
          this.activeProcesses.delete(sessionId)
          setTimeout(resolvePromise, 500)
        }
      })

      claude.onExit(() => {
        if (!finished) {
          finished = true
          this.activeProcesses.delete(sessionId)
          resolvePromise()
        }
      })

      // Store process
      this.activeProcesses.set(sessionId, {
        claude,
        sessionId,
        projectPath,
        pendingPermission,
        responses,
        resolve: resolvePromise!
      })

      // Timeout
      setTimeout(() => {
        if (!finished) {
          finished = true
          this.activeProcesses.delete(sessionId)
          claude.child.kill()
          resolvePromise()
        }
      }, 300000)

      donePromise.then(() => {
        resolve({ sessionId, responses })
      })
    })
  }

  /**
   * Respond to a permission request
   */
  respondToPermission(
    sessionId: string,
    requestId: string,
    allow: boolean,
    options: {
      allowAll?: boolean
      toolName?: string
      updatedInput?: Record<string, unknown>
    } = {}
  ): boolean {
    console.log(`[ClaudeService] Permission response: ${allow ? 'ALLOW' : 'DENY'}`)

    // Clear the timeout since we're responding
    this.clearPermissionTimeout(requestId)

    // Track as allowed if user clicked "Allow All"
    if (allow && options.allowAll && options.toolName) {
      let allowedTools = this.allowedToolsBySession.get(sessionId)
      if (!allowedTools) {
        allowedTools = new Set()
        this.allowedToolsBySession.set(sessionId, allowedTools)
      }
      allowedTools.add(options.toolName)
      console.log(`[ClaudeService] Added ${options.toolName} to allowed tools`)
    }

    // Handle active process permission (spawned by Sidecar)
    const activeProcess = this.activeProcesses.get(sessionId)
    if (activeProcess) {
      activeProcess.claude.sendPermissionResponse(requestId, allow, options.updatedInput)
      activeProcess.pendingPermission = null
      return true
    }

    // Handle hook-based permission (Claude running in terminal)
    const pendingHook = this.pendingHookPermissions.get(sessionId)
    if (pendingHook && allow) {
      console.log(`[ClaudeService] Responding to hook permission via resume`)
      this.respondToHookPermission(sessionId, pendingHook, options.updatedInput)
      return true
    }

    console.log(`[ClaudeService] No active process or hook permission found for session ${sessionId}`)
    return false
  }

  /**
   * Respond to a hook-based permission by resuming the session
   * Used when Claude is running in a terminal (not spawned by Sidecar)
   */
  private respondToHookPermission(
    sessionId: string,
    pendingHook: PendingHookPermission,
    updatedInput?: Record<string, unknown>
  ): void {
    const projectPath = findSessionProject(sessionId)
    if (!projectPath) {
      console.error(`[ClaudeService] Cannot find project for session ${sessionId}`)
      return
    }

    console.log(`[ClaudeService] Approving ${pendingHook.toolName} via resume for session ${sessionId}`)

    // Mark session as being approved to prevent re-detection during polling
    this.sessionsBeingApproved.add(sessionId)

    // Clear the pending hook permission
    this.pendingHookPermissions.delete(sessionId)

    // Spawn Claude with --resume to connect to the session
    const claude = spawnClaude({
      cwd: projectPath,
      resume: sessionId,
      onMessage: (msg) => {
        console.log(`[ClaudeService] Resume approval message: type=${msg.type}`)
        this.emitMessage(sessionId, msg)
      },
      onPermissionRequest: (permReq) => {
        // Auto-approve any permission request that comes through during resume
        console.log(`[ClaudeService] Resume: got permission request for ${permReq.toolName}, auto-approving`)
        claude.sendPermissionResponse(permReq.requestId, true, permReq.input)
      }
    })

    // Log stderr for debugging
    claude.child.stderr?.on('data', (data: Buffer) => {
      console.log(`[ClaudeService] Resume stderr: ${data.toString().trim()}`)
    })

    // Send a nudge message to trigger Claude to continue
    // The resumed process may be waiting for input
    setTimeout(() => {
      console.log(`[ClaudeService] Sending continue nudge to resumed Claude`)
      claude.send('continue')
    }, 1000)

    // Handle process exit
    claude.onExit((code) => {
      console.log(`[ClaudeService] Resume process exited with code ${code}`)
      this.sessionsBeingApproved.delete(sessionId)
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      if (this.sessionsBeingApproved.has(sessionId)) {
        console.log(`[ClaudeService] Resume approval timeout - killing process`)
        this.sessionsBeingApproved.delete(sessionId)
        claude.child.kill()
      }
    }, 30000)
  }

  /**
   * Get pending permission for a session
   */
  getPendingPermission(sessionId: string): PermissionRequest | null {
    return this.activeProcesses.get(sessionId)?.pendingPermission || null
  }

  /**
   * Get active process for a session
   */
  getActiveProcess(sessionId: string): ActiveProcess | undefined {
    return this.activeProcesses.get(sessionId)
  }

  /**
   * Abort an active session
   */
  abortSession(sessionId: string): boolean {
    const activeProcess = this.activeProcesses.get(sessionId)
    if (activeProcess) {
      console.log(`[ClaudeService] Aborting session ${sessionId}`)
      activeProcess.claude.child.kill('SIGINT')
      this.activeProcesses.delete(sessionId)
      activeProcess.resolve()
      return true
    }
    return false
  }

  /**
   * Watch a session for permissions (called when client connects)
   */
  watchSession(clientId: string, sessionId: string): PendingHookPermission | null {
    const projectPath = findSessionProject(sessionId)
    if (!projectPath) return null

    // Unwatch previous session if different
    const previousSessionId = this.clientWatchingSession.get(clientId)
    if (previousSessionId && previousSessionId !== sessionId) {
      this.unwatchSession(clientId, previousSessionId)
    }

    // Track client watching this session
    this.clientWatchingSession.set(clientId, sessionId)
    if (!this.sessionWatchers.has(sessionId)) {
      this.sessionWatchers.set(sessionId, new Set())
    }
    this.sessionWatchers.get(sessionId)!.add(clientId)

    // Initialize watched session if needed
    if (!this.watchedSessions.has(sessionId)) {
      console.log(`[ClaudeService] Client ${clientId} watching session ${sessionId}`)
      const sessionData = readSessionData(projectPath, sessionId)
      const sessionIsActive = isSessionActive(projectPath, sessionId, 30)

      const initialPendingIds = new Set<string>()
      if (!sessionIsActive) {
        for (const tool of sessionData.pendingToolCalls) {
          initialPendingIds.add(tool.id)
        }
      }

      this.watchedSessions.set(sessionId, {
        projectPath,
        lastPendingIds: initialPendingIds,
        lastMessageCount: sessionData.messages.length
      })
    }

    // Return any pending hook permission for re-sending
    const pendingHook = this.pendingHookPermissions.get(sessionId)
    if (pendingHook && (Date.now() - pendingHook.timestamp < 300000)) {
      return pendingHook
    }
    if (pendingHook) {
      this.pendingHookPermissions.delete(sessionId)
    }

    return null
  }

  /**
   * Get all pending permissions for a session (for reconnection)
   * Returns both hook-based and file-based pending permissions
   */
  getPendingPermissions(sessionId: string): Array<{
    toolName: string
    toolUseId: string
    requestId: string
    input: Record<string, unknown>
    source: 'hook' | 'file'
  }> {
    const permissions: Array<{
      toolName: string
      toolUseId: string
      requestId: string
      input: Record<string, unknown>
      source: 'hook' | 'file'
    }> = []

    // Check for hook-based permissions
    const pendingHook = this.pendingHookPermissions.get(sessionId)
    if (pendingHook && (Date.now() - pendingHook.timestamp < 300000)) {
      permissions.push({
        toolName: pendingHook.toolName,
        toolUseId: pendingHook.toolUseId,
        requestId: pendingHook.toolUseId,
        input: pendingHook.toolInput,
        source: 'hook'
      })
    }

    // Check for file-based AskUserQuestion permissions (already tracked)
    const seenToolIds = new Set<string>()
    for (const [toolId, entry] of this.pendingAskUserQuestions) {
      if (entry.sessionId === sessionId) {
        permissions.push({
          toolName: entry.tool.name,
          toolUseId: entry.tool.id,
          requestId: entry.tool.id,
          input: entry.tool.input as Record<string, unknown>,
          source: 'file'
        })
        seenToolIds.add(entry.tool.id)
      }
    }

    // Also add hook permission to seen set
    if (pendingHook) {
      seenToolIds.add(pendingHook.toolUseId)
    }

    // Check session file directly for any pending tool calls we haven't seen
    // This handles the case where user disconnects and reconnects while a permission is pending
    const projectPath = findSessionProject(sessionId)
    if (projectPath) {
      try {
        const sessionData = readSessionData(projectPath, sessionId)
        if (isSessionActive(projectPath, sessionId, 30)) {
          for (const tool of sessionData.pendingToolCalls) {
            if (seenToolIds.has(tool.id)) continue
            permissions.push({
              toolName: tool.name,
              toolUseId: tool.id,
              requestId: tool.id,
              input: tool.input as Record<string, unknown>,
              source: 'file'
            })
          }
        }
      } catch {
        // Session file not readable, skip
      }
    }

    return permissions
  }

  /**
   * Stop watching a session
   */
  unwatchSession(clientId: string, sessionId: string): void {
    this.clientWatchingSession.delete(clientId)
    const watchers = this.sessionWatchers.get(sessionId)
    if (watchers) {
      watchers.delete(clientId)
      if (watchers.size === 0) {
        console.log(`[ClaudeService] No more watchers for session ${sessionId}`)
        this.watchedSessions.delete(sessionId)
        this.sessionWatchers.delete(sessionId)
      }
    }
  }

  /**
   * Handle client disconnect
   */
  handleClientDisconnect(clientId: string): void {
    const sessionId = this.clientWatchingSession.get(clientId)
    if (sessionId) {
      this.unwatchSession(clientId, sessionId)
    }
  }

  /**
   * Handle hook notification (from Claude Code)
   */
  handleHookNotification(
    sessionId: string,
    notificationType: string,
    message: string,
    cwd?: string
  ): void {
    console.log(`[ClaudeService] Hook notification: ${notificationType} for session ${sessionId}`)

    if (notificationType === 'permission_prompt') {
      let toolName = 'Permission Required'
      let toolInput: Record<string, unknown> = { message }
      let toolUseId = `hook-${sessionId}`

      if (cwd && sessionId) {
        try {
          const sessionData = readSessionData(cwd, sessionId)
          if (sessionData.pendingToolCalls.length > 0) {
            const pendingTool = sessionData.pendingToolCalls[sessionData.pendingToolCalls.length - 1]
            toolName = pendingTool.name
            toolInput = pendingTool.input as Record<string, unknown>
            toolUseId = pendingTool.id
          }
        } catch (err) {
          console.log(`[ClaudeService] Could not read session data: ${(err as Error).message}`)
        }
      }

      this.pendingHookPermissions.set(sessionId, {
        sessionId,
        message,
        timestamp: Date.now(),
        toolName,
        toolUseId,
        toolInput
      })

      this.emitPermissionRequest(sessionId, {
        toolName,
        toolUseId,
        requestId: toolUseId,
        input: toolInput,
        source: 'hook'
      })
    }
  }

  /**
   * Poll watched sessions for changes (called on interval)
   */
  pollWatchedSessions(): void {
    for (const [sessionId, watchedSession] of this.watchedSessions) {
      // Skip if we're currently handling a permission approval via resume
      if (this.sessionsBeingApproved.has(sessionId)) {
        continue
      }

      const { projectPath, lastPendingIds } = watchedSession

      let sessionData
      try {
        sessionData = readSessionData(projectPath, sessionId)
      } catch {
        continue
      }

      // Check for new messages
      if (sessionData.messages.length > watchedSession.lastMessageCount) {
        const newMessages = sessionData.messages.slice(watchedSession.lastMessageCount)
        for (const message of newMessages) {
          this.emitMessage(sessionId, message)
        }
        watchedSession.lastMessageCount = sessionData.messages.length
      }

      // Check for resolved permissions
      const currentPendingIds = new Set(sessionData.pendingToolCalls.map(t => t.id))
      const pendingHook = this.pendingHookPermissions.get(sessionId)

      if (pendingHook && !currentPendingIds.has(pendingHook.toolUseId)) {
        console.log(`[ClaudeService] Permission resolved for session ${sessionId}`)
        this.clearPermissionTimeout(pendingHook.toolUseId)
        this.pendingHookPermissions.delete(sessionId)
        this.emitPermissionResolved(sessionId, pendingHook.toolUseId)
      }

      // Check for resolved AskUserQuestion
      for (const [toolId, entry] of this.pendingAskUserQuestions) {
        if (entry.sessionId === sessionId && !currentPendingIds.has(toolId)) {
          this.clearPermissionTimeout(toolId)
          this.pendingAskUserQuestions.delete(toolId)
          this.emitPermissionResolved(sessionId, toolId)
        }
      }

      // File-based detection for AskUserQuestion
      if (isSessionActive(projectPath, sessionId, 30)) {
        for (const tool of sessionData.pendingToolCalls) {
          if (tool.name !== 'AskUserQuestion') continue
          if (lastPendingIds.has(tool.id)) continue

          const toolTimestamp = new Date(tool.timestamp)
          const toolAgeMs = Date.now() - toolTimestamp.getTime()
          if (toolAgeMs > 30000) {
            lastPendingIds.add(tool.id)
            continue
          }

          console.log(`[ClaudeService] File-detected AskUserQuestion: ${tool.id}`)
          lastPendingIds.add(tool.id)
          this.pendingAskUserQuestions.set(tool.id, { tool, sessionId })

          this.emitPermissionRequest(sessionId, {
            toolName: tool.name,
            toolUseId: tool.id,
            requestId: tool.id,
            input: tool.input as Record<string, unknown>,
            source: 'file'
          })
        }
      }

      // Track all current pending IDs
      for (const tool of sessionData.pendingToolCalls) {
        lastPendingIds.add(tool.id)
      }
    }
  }

  /**
   * Get pending AskUserQuestion tools for a session
   */
  getPendingAskUserQuestions(sessionId: string): Array<{ tool: PendingToolCall; sessionId: string }> {
    const result: Array<{ tool: PendingToolCall; sessionId: string }> = []
    for (const [_, entry] of this.pendingAskUserQuestions) {
      if (entry.sessionId === sessionId) {
        result.push(entry)
      }
    }
    return result
  }
}

// Singleton instance
export const claudeService = new ClaudeService()
