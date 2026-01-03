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

// Permission request from Claude
export interface ClaudePermissionRequest {
  type: 'permission_request'
  permission: {
    tool: string
    path?: string
    command?: string
    description: string
  }
}

// Permission response to send to Claude
export interface PermissionResponse {
  type: 'permission_response'
  permission_response: {
    permission_grant: {
      tool: string
      path?: string
      allow: boolean
      always?: boolean
    }
  }
}

export type ClaudeMessage =
  | ClaudeSystemInit
  | ClaudeAssistantMessage
  | ClaudeResultMessage
  | ClaudePermissionRequest
  | { type: string; [key: string]: unknown }

// Question option (from AskUserQuestion tool)
export interface QuestionOption {
  label: string
  description: string
}

// Question (from AskUserQuestion tool)
export interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

// Tool call made by Claude
export interface ToolCall {
  id: string
  name: string
  input: unknown
  result?: string
  isError?: boolean
}

// Image block (from Claude's vision API)
export interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    data?: string // base64 encoded data (for type: 'base64')
    url?: string // URL (for type: 'url')
  }
}

// Content block that can be text or image
export type ContentBlock = string | ImageBlock

// Chat message (simplified for UI)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[] // Array of text strings and/or image blocks
  timestamp: string
  // Tool calls made by Claude (Read, Edit, Bash, AskUserQuestion, etc.)
  toolCalls?: ToolCall[]
}

// Helper to get text content from a message
export function getTextContent(message: ChatMessage): string {
  // Handle undefined, null, or non-array content
  if (!message.content) return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''

  return message.content
    .filter((block): block is string => typeof block === 'string')
    .join('\n')
}

// Helper to get image blocks from a message
export function getImageBlocks(message: ChatMessage): ImageBlock[] {
  // Handle undefined, null, or non-array content
  if (!message.content || !Array.isArray(message.content)) return []

  return message.content.filter((block): block is ImageBlock => typeof block === 'object' && block !== null && block.type === 'image')
}

// Helper to check if message has pending question
export function getPendingQuestion(message: ChatMessage): Question[] | null {
  const askQuestion = message.toolCalls?.find((t) => t.name === 'AskUserQuestion')
  if (askQuestion && typeof askQuestion.input === 'object' && askQuestion.input !== null) {
    const input = askQuestion.input as { questions?: Question[] }
    return input.questions || null
  }
  return null
}
