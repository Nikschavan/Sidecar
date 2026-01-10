/**
 * Claude Session Reader
 *
 * Reads messages directly from Claude's own session files.
 * Path: ~/.claude/projects/{encoded-path}/{session-id}.jsonl
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatMessage, ContentBlock as SharedContentBlock, ImageBlock } from '@sidecar/shared'

const CLAUDE_DIR = join(homedir(), '.claude', 'projects')

/**
 * Encode a project path to Claude's directory format
 * /Users/foo/project -> -Users-foo-project
 */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, '-')
}

/**
 * Get the Claude projects directory for a given cwd
 */
export function getProjectDir(cwd: string): string {
  return join(CLAUDE_DIR, encodeProjectPath(cwd))
}

/**
 * Get the session file modification time
 * Returns null if file doesn't exist
 */
export function getSessionFileMtime(cwd: string, sessionId: string): Date | null {
  const projectDir = getProjectDir(cwd)
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)
  try {
    if (!existsSync(sessionFile)) return null
    const stats = statSync(sessionFile)
    return stats.mtime
  } catch {
    return null
  }
}

/**
 * Check if a session file was recently modified (within given seconds)
 */
export function isSessionActive(cwd: string, sessionId: string, withinSeconds: number = 5): boolean {
  const mtime = getSessionFileMtime(cwd, sessionId)
  if (!mtime) return false
  const now = new Date()
  const diffMs = now.getTime() - mtime.getTime()
  return diffMs < withinSeconds * 1000
}

/**
 * Clean command XML tags from user messages for display
 */
function cleanUserMessage(text: string): string {
  // Check if this is a command message with XML tags
  const commandNameMatch = text.match(/<command-name>(.*?)<\/command-name>/s)
  if (commandNameMatch) {
    // Extract command name and format as terminal-style
    const commandName = commandNameMatch[1].trim()
    const argsMatch = text.match(/<command-args>(.*?)<\/command-args>/s)
    const args = argsMatch?.[1].trim() || ''
    return `/${commandName}${args ? ' ' + args : ''}`
  }

  return text.trim()
}

/**
 * Check if a session file has actual messages (user or assistant)
 * Returns false for sessions with only metadata (summary, queue-operation, etc.)
 */
function hasActualMessages(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')

    for (const line of lines) {
      if (!line) continue
      try {
        const entry = JSON.parse(line)
        // Check for actual user or assistant messages with content
        if ((entry.type === 'user' || entry.type === 'assistant') && entry.message) {
          return true
        }
      } catch {
        // Skip malformed lines
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Extract session name from a session file
 */
function extractSessionName(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')

    let lastSummary: string | null = null
    let slug: string | null = null
    let firstUserMessage: string | null = null

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)

        // Check for summary entry - keep the LAST one (Claude updates it as conversation evolves)
        if (entry.type === 'summary' && entry.summary) {
          lastSummary = entry.summary
        }

        // Check for slug
        if (entry.slug && !slug) {
          slug = entry.slug
        }

        // Get first user message as fallback (skip meta messages like caveats)
        if (entry.type === 'user' && entry.message?.content && !firstUserMessage && !entry.isMeta) {
          const content = entry.message.content
          let rawMessage: string | null = null
          if (typeof content === 'string') {
            rawMessage = content
          } else if (Array.isArray(content)) {
            const textBlock = content.find((c: { type: string; text?: string }) => c.type === 'text' && c.text)
            if (textBlock?.text) {
              rawMessage = textBlock.text
            }
          }
          if (rawMessage) {
            // Clean the message (format commands)
            const cleaned = cleanUserMessage(rawMessage)
            if (cleaned) {
              firstUserMessage = cleaned.slice(0, 50)
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return firstUserMessage || lastSummary || slug || null
  } catch {
    return null
  }
}

/**
 * Extract model from a session file (reads last assistant message)
 */
function extractSessionModel(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')

    // Read backwards to find the most recent assistant message with model info
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        if (entry.type === 'assistant' && entry.message?.model) {
          const fullModel = entry.message.model as string
          if (fullModel.includes('opus')) return 'opus'
          if (fullModel.includes('sonnet')) return 'sonnet'
          if (fullModel.includes('haiku')) return 'haiku'
          return 'default'
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore errors
  }
  return null
}

/**
 * List all Claude sessions for a project
 */
export function listClaudeSessions(cwd: string): Array<{
  id: string
  name: string | null
  modifiedAt: Date
  size: number
  model: string | null
}> {
  const projectDir = getProjectDir(cwd)

  if (!existsSync(projectDir)) {
    return []
  }

  const files = readdirSync(projectDir)
  const sessions: Array<{ id: string; name: string | null; modifiedAt: Date; size: number; model: string | null }> = []

  for (const file of files) {
    // Only include main session files (UUID format), not agent files
    if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
      const filePath = join(projectDir, file)
      const stats = statSync(filePath)
      const id = file.replace('.jsonl', '')
      const name = extractSessionName(filePath)

      // Skip empty/aborted sessions with no extractable name
      if (!name) continue

      // Skip sessions that have no actual messages (only metadata like summary)
      if (!hasActualMessages(filePath)) continue

      const model = extractSessionModel(filePath)

      sessions.push({
        id,
        name,
        modifiedAt: stats.mtime,
        size: stats.size,
        model
      })
    }
  }

  // Sort by most recently modified
  sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())

  return sessions
}

/**
 * Get the most recent Claude session for a project
 */
export function getMostRecentSession(cwd: string): string | null {
  const sessions = listClaudeSessions(cwd)
  return sessions.length > 0 ? sessions[0].id : null
}

/**
 * Decode a Claude directory name back to project path
 * -Users-foo-project -> /Users/foo/project
 *
 * Note: This simple decode may not work for folders with hyphens in their names.
 * Use getProjectCwdFromSession() for accurate paths.
 */
export function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, '/').replace(/-/g, '/')
}

/**
 * Get the actual cwd from a session file in the project directory.
 * This is more reliable than decoding the path since session files
 * contain the real cwd that was used.
 */
export function getProjectCwdFromSession(projectDir: string): string | null {
  try {
    const files = readdirSync(projectDir)
    // Find a session file (not agent files)
    const sessionFile = files.find(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
    if (!sessionFile) return null

    const filePath = join(projectDir, sessionFile)
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')

    // Look for a line with a cwd field
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.cwd && typeof entry.cwd === 'string') {
          return entry.cwd
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore errors
  }
  return null
}

/**
 * List all Claude projects (directories in ~/.claude/projects)
 */
export function listAllProjects(): Array<{
  path: string
  encodedPath: string
  name: string
  modifiedAt: Date
}> {
  if (!existsSync(CLAUDE_DIR)) {
    return []
  }

  const dirs = readdirSync(CLAUDE_DIR)
  const projects: Array<{ path: string; encodedPath: string; name: string; modifiedAt: Date }> = []

  for (const dir of dirs) {
    const dirPath = join(CLAUDE_DIR, dir)
    try {
      const stats = statSync(dirPath)
      if (stats.isDirectory()) {
        // Try to get the actual cwd from a session file (more reliable)
        // Fall back to simple decode if no session files exist
        const actualPath = getProjectCwdFromSession(dirPath) || decodeProjectPath(dir)
        projects.push({
          path: actualPath,
          encodedPath: dir,
          name: actualPath.split('/').pop() || actualPath,
          modifiedAt: stats.mtime
        })
      }
    } catch {
      // Skip if can't read
    }
  }

  // Sort by most recently modified
  projects.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())

  return projects
}

/**
 * Find which project a session belongs to
 */
export function findSessionProject(sessionId: string): string | null {
  const projects = listAllProjects()

  for (const project of projects) {
    const projectDir = getProjectDir(project.path)
    const sessionFile = join(projectDir, `${sessionId}.jsonl`)
    if (existsSync(sessionFile)) {
      return project.path
    }
  }

  return null
}

/**
 * Get session metadata including the model used
 * Reads the last assistant message to get the current model
 */
export function getSessionMetadata(cwd: string, sessionId: string): { model: string | null } {
  const projectDir = getProjectDir(cwd)
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)

  if (!existsSync(sessionFile)) {
    return { model: null }
  }

  try {
    const content = readFileSync(sessionFile, 'utf-8')
    const lines = content.trim().split('\n')

    // Read backwards to find the most recent assistant message with model info
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        if (entry.type === 'assistant' && entry.message?.model) {
          // Extract model alias from full model name
          // e.g., "claude-opus-4-5-20251101" -> "opus"
          const fullModel = entry.message.model as string
          if (fullModel.includes('opus')) return { model: 'opus' }
          if (fullModel.includes('sonnet')) return { model: 'sonnet' }
          return { model: 'default' }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore read errors
  }

  return { model: null }
}

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string
  is_error?: boolean
  // Image fields (for type: 'image')
  source?: {
    type: 'base64' | 'url'
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    data?: string
    url?: string
  }
}

interface ClaudeMessage {
  type: 'user' | 'assistant' | 'queue-operation' | string
  uuid: string
  timestamp: string
  isMeta?: boolean // Meta messages (caveats, system info) should be hidden from UI
  message?: {
    role: 'user' | 'assistant'
    content: string | ContentBlock[]
  }
}

/**
 * Read messages from a Claude session file
 */
export function readClaudeSession(cwd: string, sessionId: string): ChatMessage[] {
  const projectDir = getProjectDir(cwd)
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)

  if (!existsSync(sessionFile)) {
    return []
  }

  const content = readFileSync(sessionFile, 'utf-8')
  const lines = content.trim().split('\n')
  const messages: ChatMessage[] = []
  const seenIds = new Set<string>() // Dedupe messages with same UUID
  // Track tool results by tool_use_id to attach to tool calls
  const toolResults = new Map<string, { content: string; isError: boolean }>()

  // First pass: collect all tool results
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ClaudeMessage
      if (entry.type === 'user' && entry.message && Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            toolResults.set(block.tool_use_id, {
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              isError: block.is_error || false
            })
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Second pass: build messages with tool results attached
  // Track if we just saw a retry message to skip the following assistant message
  let skipNextAssistant = false
  let lastRetryToolName: string | null = null

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ClaudeMessage

      // Skip meta messages (caveats, system info)
      if (entry.isMeta) {
        continue
      }

      // Only process user and assistant messages
      if (entry.type !== 'user' && entry.type !== 'assistant') {
        continue
      }

      if (!entry.message) {
        continue
      }

      // Check if this is a retry instruction message
      if (entry.type === 'user' && entry.message?.content) {
        const content = entry.message.content
        let messageText = ''
        if (typeof content === 'string') {
          messageText = content
        } else if (Array.isArray(content)) {
          const textBlock = content.find((c: ContentBlock) => c.type === 'text' && c.text)
          if (textBlock?.text) {
            messageText = textBlock.text
          }
        }
        // Match "Retry the <ToolName> tool call now"
        const retryMatch = messageText.match(/Retry the (\w+) tool call now/)
        if (retryMatch) {
          skipNextAssistant = true
          lastRetryToolName = retryMatch[1]
          continue // Skip this retry user message
        }
      }

      // Skip assistant message that contains the retried tool call
      if (skipNextAssistant && entry.type === 'assistant' && lastRetryToolName) {
        skipNextAssistant = false
        // Check if this assistant message contains the retried tool
        const content = entry.message?.content
        if (Array.isArray(content)) {
          const hasRetryTool = content.some((c: ContentBlock) =>
            c.type === 'tool_use' && c.name === lastRetryToolName
          )
          if (hasRetryTool) {
            lastRetryToolName = null
            continue // Skip this assistant message (it's the retry response)
          }
        }
        lastRetryToolName = null
      }

      // Skip if we've already seen this message (Claude sends multiple updates)
      if (seenIds.has(entry.uuid)) {
        // But update the existing message if this one has more tool calls
        const existingIdx = messages.findIndex((m) => m.id === entry.uuid)
        if (existingIdx >= 0 && Array.isArray(entry.message.content)) {
          const toolCalls = entry.message.content
            .filter((c) => c.type === 'tool_use')
            .map((c) => {
              const result = toolResults.get(c.id || '')
              return {
                id: c.id || '',
                name: c.name || '',
                input: c.input,
                result: result?.content,
                isError: result?.isError
              }
            })
          if (toolCalls.length > 0) {
            messages[existingIdx].toolCalls = toolCalls
          }
        }
        continue
      }

      seenIds.add(entry.uuid)

      // Extract content blocks (text and images)
      const contentBlocks: SharedContentBlock[] = []
      let toolCalls: ChatMessage['toolCalls'] = undefined

      if (typeof entry.message.content === 'string') {
        contentBlocks.push(entry.message.content)
      } else if (Array.isArray(entry.message.content)) {
        // Process all content blocks
        for (const block of entry.message.content) {
          if (block.type === 'text' && block.text) {
            contentBlocks.push(block.text)
          } else if (block.type === 'image' && block.source) {
            // Add image block
            const imageBlock: ImageBlock = {
              type: 'image',
              source: {
                type: block.source.type,
                media_type: block.source.media_type,
                data: block.source.data,
                url: block.source.url
              }
            }
            contentBlocks.push(imageBlock)
          }
        }

        // Extract all tool calls with their results
        const tools = entry.message.content.filter((c) => c.type === 'tool_use')
        if (tools.length > 0) {
          toolCalls = tools.map((c) => {
            const result = toolResults.get(c.id || '')
            return {
              id: c.id || '',
              name: c.name || '',
              input: c.input,
              result: result?.content,
              isError: result?.isError
            }
          })
        }
      }

      // Skip user messages that are only tool results (no visible content)
      if (entry.type === 'user' && contentBlocks.length === 0) {
        continue
      }

      // Skip messages with no content and no tool calls
      if (contentBlocks.length === 0 && !toolCalls) {
        continue
      }

      messages.push({
        id: entry.uuid,
        role: entry.message.role,
        content: contentBlocks,
        timestamp: entry.timestamp,
        toolCalls
      })
    } catch (e) {
      // Skip malformed lines
      continue
    }
  }

  return messages
}

/**
 * Pending tool call (waiting for permission)
 */
export interface PendingToolCall {
  id: string
  name: string
  input: unknown
  timestamp: string
}

/**
 * Session data including messages and pending tool calls
 */
export interface SessionData {
  messages: ChatMessage[]
  pendingToolCalls: PendingToolCall[]
}

/**
 * Read session data (messages and pending tool calls) in a single file read
 */
export function readSessionData(cwd: string, sessionId: string): SessionData {
  const messages = readClaudeSession(cwd, sessionId)

  // Find retry messages and track which tools were retried and when
  // Format: "Retry the <ToolName> tool call now"
  const retriedTools = new Map<string, string>() // toolName -> retry message timestamp
  for (const msg of messages) {
    if (msg.role === 'user' && msg.content) {
      for (const block of msg.content) {
        if (typeof block === 'string') {
          const retryMatch = block.match(/Retry the (\w+) tool call now/)
          if (retryMatch) {
            retriedTools.set(retryMatch[1], msg.timestamp || '')
          }
        }
      }
    }
  }

  // Extract pending tool calls from messages (tool calls without results)
  // Exclude tool calls that appear BEFORE a retry message for the same tool
  const pendingToolCalls: PendingToolCall[] = []
  for (const msg of messages) {
    if (msg.toolCalls) {
      for (const tool of msg.toolCalls) {
        if (tool.result === undefined) {
          // Check if this tool was retried after this message
          const retryTimestamp = retriedTools.get(tool.name)
          if (retryTimestamp && msg.timestamp && msg.timestamp < retryTimestamp) {
            // This tool call appears before its retry message - skip it
            continue
          }

          pendingToolCalls.push({
            id: tool.id,
            name: tool.name,
            input: tool.input,
            timestamp: msg.timestamp || new Date().toISOString()
          })
        }
      }
    }
  }

  return { messages, pendingToolCalls }
}

/**
 * Detect tool calls waiting for permission (tool_use without matching tool_result)
 */
export function getPendingToolCalls(cwd: string, sessionId: string): PendingToolCall[] {
  return readSessionData(cwd, sessionId).pendingToolCalls
}

/**
 * Watch a Claude session file for changes
 */
export function watchClaudeSession(
  cwd: string,
  sessionId: string,
  callback: (messages: ChatMessage[]) => void
): () => void {
  const projectDir = getProjectDir(cwd)
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)

  // Use polling since FSWatcher can be unreliable
  let lastSize = 0

  const check = () => {
    try {
      if (!existsSync(sessionFile)) return

      const stats = statSync(sessionFile)
      if (stats.size !== lastSize) {
        lastSize = stats.size
        const messages = readClaudeSession(cwd, sessionId)
        callback(messages)
      }
    } catch (e) {
      // Ignore errors
    }
  }

  const interval = setInterval(check, 1000)
  check() // Initial read

  return () => clearInterval(interval)
}
