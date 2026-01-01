/**
 * File-based store for session persistence
 *
 * Storage structure:
 *   ~/.sidecar/
 *   ├── sessions.json          # Index of all sessions
 *   └── sessions/
 *       ├── {session-id}.jsonl # Messages for each session
 *       └── ...
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ChatMessage } from '@sidecar/shared'

export interface StoredSession {
  id: string
  claudeSessionId: string | null
  cwd: string
  active: boolean
  createdAt: string
  lastUsedAt: string
}

export interface SessionIndex {
  sessions: StoredSession[]
}

export interface Store {
  // Session management
  listSessions: () => StoredSession[]
  getSession: (id: string) => StoredSession | null
  createSession: (cwd: string) => StoredSession
  updateSession: (id: string, updates: Partial<StoredSession>) => void

  // Message management
  getMessages: (sessionId: string) => ChatMessage[]
  appendMessage: (sessionId: string, message: ChatMessage) => void
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
}

export function createStore(baseDir?: string): Store {
  const sidecarDir = baseDir || join(homedir(), '.sidecar')
  const sessionsDir = join(sidecarDir, 'sessions')
  const indexPath = join(sidecarDir, 'sessions.json')

  // Ensure directories exist
  if (!existsSync(sidecarDir)) {
    mkdirSync(sidecarDir, { recursive: true })
  }
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true })
  }

  // Load or create index
  function loadIndex(): SessionIndex {
    if (existsSync(indexPath)) {
      try {
        return JSON.parse(readFileSync(indexPath, 'utf-8'))
      } catch {
        return { sessions: [] }
      }
    }
    return { sessions: [] }
  }

  function saveIndex(index: SessionIndex): void {
    writeFileSync(indexPath, JSON.stringify(index, null, 2))
  }

  function getSessionFilePath(sessionId: string): string {
    return join(sessionsDir, `${sessionId}.jsonl`)
  }

  return {
    listSessions() {
      const index = loadIndex()
      // Sort by lastUsedAt descending
      return index.sessions.sort((a, b) =>
        new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
      )
    },

    getSession(id: string) {
      const index = loadIndex()
      return index.sessions.find(s => s.id === id) || null
    },

    createSession(cwd: string) {
      const index = loadIndex()
      const now = new Date().toISOString()

      const session: StoredSession = {
        id: generateId(),
        claudeSessionId: null,
        cwd,
        active: true,
        createdAt: now,
        lastUsedAt: now
      }

      index.sessions.push(session)
      saveIndex(index)

      // Create empty message file
      writeFileSync(getSessionFilePath(session.id), '')

      console.log(`[store] Created session ${session.id}`)
      return session
    },

    updateSession(id: string, updates: Partial<StoredSession>) {
      const index = loadIndex()
      const session = index.sessions.find(s => s.id === id)

      if (session) {
        Object.assign(session, updates, { lastUsedAt: new Date().toISOString() })
        saveIndex(index)
      }
    },

    getMessages(sessionId: string) {
      const filePath = getSessionFilePath(sessionId)

      if (!existsSync(filePath)) {
        return []
      }

      const content = readFileSync(filePath, 'utf-8')
      const messages: ChatMessage[] = []

      for (const line of content.split('\n')) {
        if (line.trim()) {
          try {
            messages.push(JSON.parse(line))
          } catch {
            // Skip invalid lines
          }
        }
      }

      return messages
    },

    appendMessage(sessionId: string, message: ChatMessage) {
      const filePath = getSessionFilePath(sessionId)
      appendFileSync(filePath, JSON.stringify(message) + '\n')
    }
  }
}
