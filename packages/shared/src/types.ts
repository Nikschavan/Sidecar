/**
 * Core types for Sidecar
 */

// Session state
export type SessionState = 'idle' | 'thinking' | 'waiting_input' | 'permission_prompt'

// Session info
export interface SessionInfo {
  id: string
  startTime: string
  cwd: string
  state: SessionState
}

// Claude message types (from JSON streaming)
export interface ClaudeSystemInit {
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  tools: string[]
}

export interface ClaudeAssistantMessage {
  type: 'assistant'
  message: {
    role: 'assistant'
    content: Array<{
      type: 'text' | 'thinking' | 'tool_use'
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: unknown
    }>
  }
}

export interface ClaudeResultMessage {
  type: 'result'
  result: string
  duration_ms: number
  is_error: boolean
}

export type ClaudeMessage = ClaudeSystemInit | ClaudeAssistantMessage | ClaudeResultMessage | { type: string; [key: string]: unknown }

// Chat message (simplified for UI)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}
