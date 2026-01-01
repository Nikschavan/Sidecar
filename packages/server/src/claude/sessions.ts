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
 * List all Claude sessions for a project
 */
export function listClaudeSessions(cwd: string): Array<{
  id: string
  modifiedAt: Date
  size: number
}> {
  const projectDir = getProjectDir(cwd)

  if (!existsSync(projectDir)) {
    return []
  }

  const files = readdirSync(projectDir)
  const sessions: Array<{ id: string; modifiedAt: Date; size: number }> = []

  for (const file of files) {
    // Only include main session files (UUID format), not agent files
    if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
      const filePath = join(projectDir, file)
      const stats = statSync(filePath)
      const id = file.replace('.jsonl', '')

      sessions.push({
        id,
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

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
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
            .map((c) => ({
              id: c.id || '',
              name: c.name || '',
              input: c.input
            }))
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

        // Extract all tool calls
        const tools = entry.message.content.filter((c) => c.type === 'tool_use')
        if (tools.length > 0) {
          toolCalls = tools.map((c) => ({
            id: c.id || '',
            name: c.name || '',
            input: c.input
          }))
        }
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
