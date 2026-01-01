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

export type ServerMessage =
  | ServerConnectedMessage
  | ServerHistoryMessage
  | ServerMessageMessage
  | ServerStateChangeMessage
  | ServerErrorMessage

// Client -> Server messages
export interface ClientSendMessage {
  type: 'send'
  text: string
}

export interface ClientPingMessage {
  type: 'ping'
}

export type ClientMessage = ClientSendMessage | ClientPingMessage
