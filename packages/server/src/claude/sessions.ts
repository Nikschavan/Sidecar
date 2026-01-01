/**
 * Claude Session Reader
 *
 * Reads messages directly from Claude's own session files.
 * Path: ~/.claude/projects/{encoded-path}/{session-id}.jsonl
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatMessage } from '@sidecar/shared'

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
 * Extract session name from a session file
 */
function extractSessionName(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')

    let summary: string | null = null
    let slug: string | null = null
    let firstUserMessage: string | null = null

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)

        // Check for summary entry (highest priority)
        if (entry.type === 'summary' && entry.summary) {
          summary = entry.summary
        }

        // Check for slug
        if (entry.slug && !slug) {
          slug = entry.slug
        }

        // Get first user message as fallback
        if (entry.type === 'user' && entry.message?.content && !firstUserMessage) {
          const content = entry.message.content
          if (typeof content === 'string') {
            firstUserMessage = content.slice(0, 50)
          } else if (Array.isArray(content)) {
            const textBlock = content.find((c: { type: string; text?: string }) => c.type === 'text' && c.text)
            if (textBlock?.text) {
              firstUserMessage = textBlock.text.slice(0, 50)
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return summary || slug || firstUserMessage || null
  } catch {
    return null
  }
}

/**
 * List all Claude sessions for a project
 */
export function listClaudeSessions(cwd: string): Array<{
  id: string
  name: string | null
  modifiedAt: Date
  size: number
}> {
  const projectDir = getProjectDir(cwd)

  if (!existsSync(projectDir)) {
    return []
  }

  const files = readdirSync(projectDir)
  const sessions: Array<{ id: string; name: string | null; modifiedAt: Date; size: number }> = []

  for (const file of files) {
    // Only include main session files (UUID format), not agent files
    if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
      const filePath = join(projectDir, file)
      const stats = statSync(filePath)
      const id = file.replace('.jsonl', '')
      const name = extractSessionName(filePath)

      sessions.push({
        id,
        name,
        modifiedAt: stats.mtime,
        size: stats.size
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
 */
export function decodeProjectPath(encoded: string): string {
  return encoded.replace(/^-/, '/').replace(/-/g, '/')
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
        const decodedPath = decodeProjectPath(dir)
        projects.push({
          path: decodedPath,
          encodedPath: dir,
          name: decodedPath.split('/').pop() || decodedPath,
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
}

interface ClaudeMessage {
  type: 'user' | 'assistant' | 'queue-operation' | string
  uuid: string
  timestamp: string
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
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ClaudeMessage

      // Only process user and assistant messages
      if (entry.type !== 'user' && entry.type !== 'assistant') {
        continue
      }

      if (!entry.message) {
        continue
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

      // Extract text content
      let text = ''
      let toolCalls: ChatMessage['toolCalls'] = undefined

      if (typeof entry.message.content === 'string') {
        text = entry.message.content
      } else if (Array.isArray(entry.message.content)) {
        // Join all text blocks
        const textBlocks = entry.message.content.filter(
          (c) => c.type === 'text' && c.text
        )
        text = textBlocks.map((c) => c.text).join('\n')

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

      // Skip user messages that are only tool results (no visible text)
      if (entry.type === 'user' && !text) {
        continue
      }

      // Skip messages with no text and no tool calls
      if (!text && !toolCalls) {
        continue
      }

      messages.push({
        id: entry.uuid,
        role: entry.message.role,
        content: text,
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
 * Detect tool calls waiting for permission (tool_use without matching tool_result)
 */
export function getPendingToolCalls(cwd: string, sessionId: string): PendingToolCall[] {
  const projectDir = getProjectDir(cwd)
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)

  if (!existsSync(sessionFile)) {
    return []
  }

  const content = readFileSync(sessionFile, 'utf-8')
  const lines = content.trim().split('\n')

  // Track all tool_use IDs and tool_result IDs
  const toolUses = new Map<string, PendingToolCall>()
  const toolResults = new Set<string>()

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)

      // Find tool_use blocks in assistant messages
      if (entry.type === 'assistant' && entry.message?.content) {
        const content = entry.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use' && block.id) {
              toolUses.set(block.id, {
                id: block.id,
                name: block.name || 'unknown',
                input: block.input || {},
                timestamp: entry.timestamp || new Date().toISOString()
              })
            }
          }
        }
      }

      // Find tool_result blocks in user messages
      if (entry.type === 'user' && entry.message?.content) {
        const content = entry.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              toolResults.add(block.tool_use_id)
            }
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Find tool_use without matching tool_result
  const pending: PendingToolCall[] = []
  for (const [id, toolUse] of toolUses) {
    if (!toolResults.has(id)) {
      pending.push(toolUse)
    }
  }

  return pending
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
