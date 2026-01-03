/**
 * Claude Service
 *
 * Manages Claude processes, permissions, and session watching
 */

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

  // Event handlers
  private messageHandlers: MessageHandler[] = []
  private permissionHandlers: PermissionHandler[] = []
  private permissionResolvedHandlers: PermissionResolvedHandler[] = []

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

    const activeProcess = this.activeProcesses.get(sessionId)
    if (activeProcess) {
      activeProcess.claude.sendPermissionResponse(requestId, allow, options.updatedInput)
      activeProcess.pendingPermission = null
      return true
    }

    return false
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
        this.pendingHookPermissions.delete(sessionId)
        this.emitPermissionResolved(sessionId, pendingHook.toolUseId)
      }

      // Check for resolved AskUserQuestion
      for (const [toolId, entry] of this.pendingAskUserQuestions) {
        if (entry.sessionId === sessionId && !currentPendingIds.has(toolId)) {
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
