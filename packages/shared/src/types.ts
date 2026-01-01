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
}

// Chat message (simplified for UI)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  // Tool calls made by Claude (Read, Edit, Bash, AskUserQuestion, etc.)
  toolCalls?: ToolCall[]
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
