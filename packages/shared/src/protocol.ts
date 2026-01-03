/**
 * WebSocket protocol definitions
 */

import type { ChatMessage, SessionInfo, SessionState } from './types.js'

// Server -> Client messages
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

// Client -> Server messages
export interface ClientSendMessage {
  type: 'send'
  text: string
}

export interface ClientSubscribeMessage {
  type: 'subscribe'
  sessionId: string
}

export interface ClientPingMessage {
  type: 'ping'
}


// Permission response from user (approve/deny)
export interface ClientPermissionResponseMessage {
  type: 'permission_response'
  sessionId: string
  requestId: string
  allow: boolean
  updatedInput?: Record<string, unknown>
}

// Watch session for file-based permission detection
export interface ClientWatchSessionMessage {
  type: 'watch_session'
  sessionId: string
}

// Abort current Claude processing (like Ctrl+C)
export interface ClientAbortSessionMessage {
  type: 'abort_session'
  sessionId: string
}

export type ClientMessage =
  | ClientSendMessage
  | ClientSubscribeMessage
  | ClientPingMessage
  | ClientPermissionResponseMessage
  | ClientWatchSessionMessage
  | ClientAbortSessionMessage
