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
}

export interface ServerStateChangeMessage {
  type: 'state_change'
  state: SessionState
}

export interface ServerErrorMessage {
  type: 'error'
  error: string
}

// Server -> CLI messages
export interface ServerPhoneMessage {
  type: 'phone_message'
  text: string
}

export interface ServerSwitchToRemoteMessage {
  type: 'switch_to_remote'
}

// Server -> Phone messages
export interface ServerSessionUpdateMessage {
  type: 'session_update'
  sessionId: string | null
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
}

export type ServerMessage =
  | ServerConnectedMessage
  | ServerHistoryMessage
  | ServerMessageMessage
  | ServerStateChangeMessage
  | ServerErrorMessage
  | ServerPhoneMessage
  | ServerSwitchToRemoteMessage
  | ServerSessionUpdateMessage
  | ServerClaudeMessageMessage
  | ServerPermissionRequestMessage

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

// CLI client messages
export interface ClientRegisterCliMessage {
  type: 'register_cli'
  timestamp: string
}

export interface ClientSetSessionMessage {
  type: 'set_session'
  sessionId: string
  timestamp: string
}

export interface ClientClaudeMessageMessage {
  type: 'claude_message'
  message: unknown
  timestamp: string
}

// Phone client messages
export interface ClientRegisterPhoneMessage {
  type: 'register_phone'
  timestamp: string
}

export interface ClientPhoneSendMessage {
  type: 'phone_send'
  text: string
  timestamp: string
}

export interface ClientTakeOverMessage {
  type: 'take_over'
  timestamp: string
}

// Permission response from user (approve/deny)
export interface ClientPermissionResponseMessage {
  type: 'permission_response'
  sessionId: string
  requestId: string
  allow: boolean
  updatedInput?: Record<string, unknown>
}

export type ClientMessage =
  | ClientSendMessage
  | ClientSubscribeMessage
  | ClientPingMessage
  | ClientRegisterCliMessage
  | ClientSetSessionMessage
  | ClientClaudeMessageMessage
  | ClientRegisterPhoneMessage
  | ClientPhoneSendMessage
  | ClientTakeOverMessage
  | ClientPermissionResponseMessage
