/**
 * SSE protocol definitions
 *
 * Server-Sent Events for real-time updates.
 * Client-to-server actions are now REST API calls.
 */

import type { ChatMessage, SessionInfo, SessionState } from './types.js'

// SSE Event Types
export type SSEEventType =
  | 'connected'
  | 'claude_message'
  | 'permission_request'
  | 'permission_resolved'
  | 'permission_timeout'
  | 'state_change'
  | 'message'
  | 'session_aborted'
  | 'heartbeat'

// Server -> Client SSE events

export interface ServerConnectedMessage {
  type: 'connected'
  session: SessionInfo
}

export interface ServerHistoryMessage {
  type: 'history'
  messages: ChatMessage[]
}

export interface ServerMessageMessage {
  type: 'message'
  message: ChatMessage
  sessionId?: string
}

export interface ServerStateChangeMessage {
  type: 'state_change'
  state: SessionState
  sessionId?: string
}

export interface ServerErrorMessage {
  type: 'error'
  error: string
}


export interface ServerClaudeMessageMessage {
  type: 'claude_message'
  message: unknown
  sessionId?: string
}

// Permission request from Claude (needs user approval)
export interface ServerPermissionRequestMessage {
  type: 'permission_request'
  sessionId: string
  requestId: string
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  permissionSuggestions?: Array<{
    type: string
    mode?: string
    destination?: string
  }>
  source?: 'process' | 'file' | 'hook' // 'process' = active spawn, 'file' = detected from session file, 'hook' = from Claude Code notification hook
}

// Permission resolved (was handled in terminal)
export interface ServerPermissionResolvedMessage {
  type: 'permission_resolved'
  sessionId: string
  toolId: string
}

// Session was aborted (Ctrl+C equivalent)
export interface ServerSessionAbortedMessage {
  type: 'session_aborted'
  sessionId: string
}

// Permission request timed out (auto-denied after 60s)
export interface ServerPermissionTimeoutMessage {
  type: 'permission_timeout'
  sessionId: string
  requestId: string
  toolName: string
  message: string
}

export type ServerMessage =
  | ServerConnectedMessage
  | ServerHistoryMessage
  | ServerMessageMessage
  | ServerStateChangeMessage
  | ServerErrorMessage
  | ServerClaudeMessageMessage
  | ServerPermissionRequestMessage
  | ServerPermissionResolvedMessage
  | ServerSessionAbortedMessage
  | ServerPermissionTimeoutMessage

// Alias for SSE
export type SSEEvent = ServerMessage

/**
 * Client -> Server messages
 * @deprecated These are now handled via REST API endpoints:
 * - permission_response: POST /api/claude/sessions/:sessionId/permission
 * - abort_session: POST /api/sessions/:sessionId/abort
 * - watch_session: Handled via SSE connection to /api/events/:sessionId
 */

/** @deprecated Use POST /api/claude/sessions/:sessionId/send instead */
export interface ClientSendMessage {
  type: 'send'
  text: string
}

/** @deprecated Session watching is now implicit via SSE connection */
export interface ClientSubscribeMessage {
  type: 'subscribe'
  sessionId: string
}

/** @deprecated SSE has built-in connection keep-alive */
export interface ClientPingMessage {
  type: 'ping'
}


/** @deprecated Use POST /api/claude/sessions/:sessionId/permission instead */
export interface ClientPermissionResponseMessage {
  type: 'permission_response'
  sessionId: string
  requestId: string
  allow: boolean
  updatedInput?: Record<string, unknown>
}

/** @deprecated Session watching is now implicit via SSE connection */
export interface ClientWatchSessionMessage {
  type: 'watch_session'
  sessionId: string
}

/** @deprecated Use POST /api/sessions/:sessionId/abort instead */
export interface ClientAbortSessionMessage {
  type: 'abort_session'
  sessionId: string
}

/** @deprecated Client messages are now REST API calls */
export type ClientMessage =
  | ClientSendMessage
  | ClientSubscribeMessage
  | ClientPingMessage
  | ClientPermissionResponseMessage
  | ClientWatchSessionMessage
  | ClientAbortSessionMessage
