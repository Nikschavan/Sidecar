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
  lastActivityTime: number  // Timestamp of last message/activity
  hasEmittedCompletion: boolean  // Track if we've already emitted completion for inactivity
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

  // Track pending approvals - when user approves, auto-approve follow-up requests with new request_id
  // Key: sessionId, Value: { toolName, input, expiresAt }
  private pendingApprovals = new Map<string, { toolName: string; input: Record<string, unknown>; expiresAt: number }>()

  // Track denied/cancelled permission IDs to prevent re-sending on reconnection
  private deniedPermissionIds = new Set<string>()

  // Track permission IDs handled via retry approach (don't show as pending after reload)
  private handledViaRetryIds = new Set<string>()

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
   * Clear expired pending approvals
   */
  private clearExpiredPendingApprovals(): void {
    const now = Date.now()
    for (const [sessionId, approval] of this.pendingApprovals) {
      if (now >= approval.expiresAt) {
        console.log(`[ClaudeService] Clearing expired pending approval for session ${sessionId}`)
        this.pendingApprovals.delete(sessionId)
      }
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
    // Claude's raw JSON format from spawned process:
    // - System messages: { type: "system", subtype: "init|hook_response|...", ... } - skip these
    // - Wrapped messages: { type: "assistant"|"user", message: { id, role, content, ... } } - unwrap
    // - Result messages: { type: "result", result: "...", duration_ms, is_error } - emit for processing complete
    //
    // File polling format (already unwrapped):
    // - Chat messages: { id, role, content, timestamp }
    const rawMsg = message as { type?: string; role?: string; id?: string; subtype?: string; message?: unknown }

    // Skip system messages that aren't relevant to chat UI (init, hook_response, etc.)
    if (rawMsg.type === 'system') {
      return
    }

    // Allow result messages through (for processing complete detection)
    if (rawMsg.type === 'result') {
      for (const handler of this.messageHandlers) {
        handler(sessionId, message)
      }
      return
    }

    // Unwrap nested messages from spawned process
    // Format: { type: "assistant"|"user", message: { id, role, content, ... } }
    let chatMessage = message
    if (rawMsg.type && rawMsg.message && !rawMsg.role) {
      chatMessage = rawMsg.message
    }

    const chat = chatMessage as { role?: string; id?: string; content?: unknown[]; type?: string; toolCalls?: unknown[]; timestamp?: string }

    // Only emit messages that have both 'role' and 'id' (valid chat messages)
    if (!chat.role || !chat.id) {
      return
    }

    // Normalize message to ChatMessage format expected by UI
    const normalizedMessage = this.normalizeMessage(chat)

    // Preserve toolCalls from file-polled messages (already processed by readSessionData)
    if (chat.toolCalls && !normalizedMessage.toolCalls) {
      normalizedMessage.toolCalls = chat.toolCalls
    }

    // Preserve timestamp from file-polled messages
    if (chat.timestamp) {
      normalizedMessage.timestamp = chat.timestamp
    }

    // Filter out our internal retry messages (they get saved to session file and read back)
    const normalizedContent = normalizedMessage.content as unknown[] | undefined
    if (normalizedContent && normalizedContent.length > 0) {
      for (const item of normalizedContent) {
        if (typeof item === 'string' && item.includes('Retry the') && item.includes('tool call now')) {
          return // Don't emit retry instruction messages
        }
      }
    }

    for (const handler of this.messageHandlers) {
      handler(sessionId, normalizedMessage)
    }
  }

  /**
   * Normalize Claude's message format to ChatMessage format
   * Claude sends: { type: "message", id, role, content: [{type:"text",text:"..."}], model, usage, ... }
   * UI expects: { id, role, content: ["string"], timestamp, toolCalls?: [...] }
   */
  private normalizeMessage(msg: Record<string, unknown>): Record<string, unknown> {
    const content = msg.content as unknown[] | undefined
    const normalizedContent: unknown[] = []
    const toolCalls: unknown[] = []

    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string') {
          // Already a string, keep as-is
          normalizedContent.push(block)
        } else if (block && typeof block === 'object') {
          const b = block as { type?: string; text?: string; id?: string; name?: string; input?: unknown }
          if (b.type === 'text' && b.text) {
            // Convert {type:"text", text:"..."} to just the string
            normalizedContent.push(b.text)
          } else if (b.type === 'tool_use' && b.id && b.name) {
            // Extract tool calls
            toolCalls.push({
              id: b.id,
              name: b.name,
              input: b.input
            })
          } else if (b.type === 'tool_result') {
            // Tool results go in content for user messages
            normalizedContent.push(block)
          } else if (b.type === 'image') {
            // Keep image blocks as-is
            normalizedContent.push(block)
          }
        }
      }
    }

    const normalized: Record<string, unknown> = {
      id: msg.id,
      role: msg.role,
      content: normalizedContent,
      timestamp: new Date().toISOString()
    }

    if (toolCalls.length > 0) {
      normalized.toolCalls = toolCalls
    }

    return normalized
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
          // Emit result messages to UI (signals processing complete)
          const rawMsg = msg as { type?: string }
          if (rawMsg.type === 'result' && newSessionId) {
            this.emitMessage(newSessionId, msg)
          }
          // Don't emit chat messages here - file polling handles those to avoid duplicates
        },
        onPermissionRequest: (permReq) => {
          console.log(`[ClaudeService] Permission request for ${permReq.toolName}`)
          if (newSessionId) {
            // Check for pending approval (user already approved, but new request_id generated)
            const pendingApproval = this.pendingApprovals.get(newSessionId)
            if (pendingApproval &&
                pendingApproval.toolName === permReq.toolName &&
                Date.now() < pendingApproval.expiresAt) {
              console.log(`[ClaudeService] Auto-approving ${permReq.toolName} (pending approval with new request_id)`)
              this.pendingApprovals.delete(newSessionId)
              claude.sendPermissionResponse(permReq.requestId, true, permReq.input)
              return
            }

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
          // Don't emit here - file polling handles message emission to avoid duplicates
        },
        onPermissionRequest: (permReq) => {
          console.log(`[ClaudeService] Permission request for ${permReq.toolName}`)

          // Check if tool is already allowed (Allow All)
          const allowedTools = this.allowedToolsBySession.get(sessionId)
          if (allowedTools?.has(permReq.toolName)) {
            console.log(`[ClaudeService] Auto-approving ${permReq.toolName} (allowed tool)`)
            claude.sendPermissionResponse(permReq.requestId, true, permReq.input)
            return
          }

          // Check for pending approval (user already approved, but new request_id generated)
          const pendingApproval = this.pendingApprovals.get(sessionId)
          if (pendingApproval &&
              pendingApproval.toolName === permReq.toolName &&
              Date.now() < pendingApproval.expiresAt) {
            console.log(`[ClaudeService] Auto-approving ${permReq.toolName} (pending approval with new request_id)`)
            this.pendingApprovals.delete(sessionId)
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
        // Emit result messages to UI (signals processing complete)
        if (msg.type === 'result') {
          this.emitMessage(sessionId, msg)
        }

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
      answer?: string  // For AskUserQuestion: the user's selected answer
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
      console.log(`[ClaudeService] Sending permission response to active process ${sessionId}`)

      // Track this approval so follow-up requests with NEW request_id are auto-approved
      // Get toolName from options or from pendingPermission
      const toolNameToTrack = options.toolName || activeProcess.pendingPermission?.toolName
      const inputToTrack = options.updatedInput || activeProcess.pendingPermission?.input || {}

      if (allow && toolNameToTrack) {
        this.pendingApprovals.set(sessionId, {
          toolName: toolNameToTrack,
          input: inputToTrack,
          expiresAt: Date.now() + 30000  // 30 second expiry
        })
        console.log(`[ClaudeService] Stored pending approval for ${toolNameToTrack}`)
      }

      activeProcess.claude.sendPermissionResponse(requestId, allow, inputToTrack)
      activeProcess.pendingPermission = null
      return true
    }

    // Handle hook-based permission (Claude running in terminal)
    const pendingHook = this.pendingHookPermissions.get(sessionId)
    if (pendingHook && allow) {
      console.log(`[ClaudeService] Responding to hook permission via resume`)
      this.respondToHookPermission(sessionId, pendingHook, options.updatedInput, options.answer)
      return true
    }

    // Handle denial - track as denied to prevent re-sending on reconnection
    if (!allow) {
      console.log(`[ClaudeService] Permission denied for ${requestId}, tracking to prevent re-send`)
      this.deniedPermissionIds.add(requestId)
      // Clear from pending maps if present
      this.pendingHookPermissions.delete(sessionId)
      this.pendingAskUserQuestions.delete(requestId)
      this.emitPermissionResolved(sessionId, requestId)
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
    updatedInput?: Record<string, unknown>,
    answer?: string  // For AskUserQuestion: the user's selected answer
  ): void {
    const projectPath = findSessionProject(sessionId)
    if (!projectPath) {
      console.error(`[ClaudeService] Cannot find project for session ${sessionId}`)
      return
    }

    const toolName = pendingHook.toolName
    console.log(`[ClaudeService] Approving ${toolName} via retry approach for session ${sessionId}`)

    // Mark session as being approved to prevent re-detection during polling
    this.sessionsBeingApproved.add(sessionId)

    // Mark this permission as handled via retry (so it doesn't show as pending after reload)
    this.handledViaRetryIds.add(pendingHook.toolUseId)

    // Clear the pending hook permission
    this.pendingHookPermissions.delete(sessionId)

    // Craft retry message that instructs Claude to just retry the tool without extra commentary
    const retryMessage = `Retry the ${toolName} tool call now. Do not add any text, just use the tool. Ask Exact same question/tool call.`

    // Track that we sent a retry message so we can filter it from UI
    let skipNextUserMessage = true
    // Also skip the first assistant message that contains the retried tool
    let skipNextAssistantWithTool = true

    // Spawn Claude with --resume to connect to the session
    const claude = spawnClaude({
      cwd: projectPath,
      resume: sessionId,
      onMessage: (msg) => {
        const rawMsg = msg as { type?: string; message?: { role?: string; content?: unknown[] }; role?: string; content?: unknown[] }
        // Skip the retry message we sent (it's a user message)
        if (skipNextUserMessage) {
          const isUserMsg = rawMsg.type === 'user' ||
            (rawMsg.message && rawMsg.message.role === 'user')
          if (isUserMsg) {
            skipNextUserMessage = false
            return // Don't emit this message to UI
          }
        }
        // Skip the first assistant message that contains the retried tool
        if (skipNextAssistantWithTool) {
          const isAssistantMsg = rawMsg.type === 'assistant' ||
            (rawMsg.message && rawMsg.message.role === 'assistant') ||
            rawMsg.role === 'assistant'
          if (isAssistantMsg) {
            // Check if this message contains the retried tool
            const content = (rawMsg.content || rawMsg.message?.content) as Array<{ type?: string; name?: string }> | undefined
            if (Array.isArray(content)) {
              const hasRetryTool = content.some((block) =>
                block.type === 'tool_use' && block.name === toolName
              )
              if (hasRetryTool) {
                skipNextAssistantWithTool = false
                return // Don't emit this message to UI (it's the retry tool call)
              }
            }
            skipNextAssistantWithTool = false
          }
        }
        // Don't emit here - file polling handles message emission to avoid duplicates
      },
      onPermissionRequest: (permReq) => {
        // For AskUserQuestion, use updatedInput which contains user's answers
        // For other tools (Write, Bash, etc.), use the original input from the new request
        const inputToSend = (permReq.toolName === 'AskUserQuestion' && updatedInput)
          ? updatedInput
          : permReq.input
        claude.sendPermissionResponse(permReq.requestId, true, inputToSend)
        // Emit permission resolved to close BOTH the original and new popup
        this.emitPermissionResolved(sessionId, pendingHook.toolUseId)
        if (permReq.toolUseId !== pendingHook.toolUseId) {
          this.emitPermissionResolved(sessionId, permReq.toolUseId)
        }
      }
    })

    // Send retry message immediately to trigger Claude to retry the operation
    claude.send(retryMessage)

    // Handle process exit
    claude.onExit(() => {
      this.sessionsBeingApproved.delete(sessionId)
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      if (this.sessionsBeingApproved.has(sessionId)) {
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
        lastMessageCount: sessionData.messages.length,
        lastActivityTime: Date.now(),
        hasEmittedCompletion: false
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

    // Check for hook-based permissions (skip if denied)
    const pendingHook = this.pendingHookPermissions.get(sessionId)
    if (pendingHook && (Date.now() - pendingHook.timestamp < 300000) && !this.deniedPermissionIds.has(pendingHook.toolUseId)) {
      permissions.push({
        toolName: pendingHook.toolName,
        toolUseId: pendingHook.toolUseId,
        requestId: pendingHook.toolUseId,
        input: pendingHook.toolInput,
        source: 'hook'
      })
    }

    // Check for file-based AskUserQuestion permissions (already tracked, skip if denied)
    const seenToolIds = new Set<string>()
    for (const [toolId, entry] of this.pendingAskUserQuestions) {
      if (entry.sessionId === sessionId && !this.deniedPermissionIds.has(toolId)) {
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
    // Note: readSessionData() already filters out tool calls that were handled via retry
    const projectPath = findSessionProject(sessionId)
    if (projectPath) {
      try {
        const sessionData = readSessionData(projectPath, sessionId)
        if (isSessionActive(projectPath, sessionId, 30)) {
          for (const tool of sessionData.pendingToolCalls) {
            if (seenToolIds.has(tool.id)) continue
            if (this.deniedPermissionIds.has(tool.id)) continue // Skip denied permissions
            if (this.handledViaRetryIds.has(tool.id)) continue // Skip already handled via retry

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

    // Skip if we're currently handling a permission approval via resume
    if (this.sessionsBeingApproved.has(sessionId)) {
      console.log(`[ClaudeService] Skipping hook notification - session being approved`)
      return
    }

    if (notificationType === 'permission_prompt') {
      let toolName = 'Permission Required'
      let toolInput: Record<string, unknown> = { message }
      let toolUseId = `hook-${sessionId}`

      if (cwd && sessionId) {
        try {
          // readSessionData() already filters out tool calls that were handled via retry
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

      // Skip if this permission was already handled via retry approach
      if (this.handledViaRetryIds.has(toolUseId)) {
        console.log(`[ClaudeService] Skipping hook notification - permission already handled via retry`)
        return
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
    // Clean up any expired pending approvals
    this.clearExpiredPendingApprovals()

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

      // Check for new messages (from terminal sessions or external changes)
      if (sessionData.messages.length > watchedSession.lastMessageCount) {
        const newMessages = sessionData.messages.slice(watchedSession.lastMessageCount)
        for (const message of newMessages) {
          this.emitMessage(sessionId, message)
        }
        watchedSession.lastMessageCount = sessionData.messages.length
        // Reset activity tracking when new messages arrive
        watchedSession.lastActivityTime = Date.now()
        watchedSession.hasEmittedCompletion = false
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

      // Track all current pending IDs
      for (const tool of sessionData.pendingToolCalls) {
        lastPendingIds.add(tool.id)
      }

      // Check for inactivity timeout (10 seconds with no new messages and no pending tools)
      // This signals completion for terminal sessions where we don't get result messages
      const INACTIVITY_TIMEOUT_MS = 10000
      const timeSinceActivity = Date.now() - watchedSession.lastActivityTime
      const hasPendingTools = currentPendingIds.size > 0 ||
        this.pendingHookPermissions.has(sessionId) ||
        Array.from(this.pendingAskUserQuestions.values()).some(e => e.sessionId === sessionId)

      if (!watchedSession.hasEmittedCompletion &&
          !hasPendingTools &&
          timeSinceActivity >= INACTIVITY_TIMEOUT_MS) {
        // Emit synthetic result message to signal processing complete
        this.emitMessage(sessionId, { type: 'result', result: '', duration_ms: 0 })
        watchedSession.hasEmittedCompletion = true
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
