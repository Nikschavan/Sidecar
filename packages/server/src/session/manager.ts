/**
 * Session Manager
 *
 * Manages multiple Claude sessions with file-based persistence
 */

import { spawnClaude, type ClaudeProcess } from '../claude/spawn.js'
import { createStore, type Store, type StoredSession } from '../store/index.js'
import type { ChatMessage, SessionState, ClaudeMessage } from '@sidecar/shared'
import { randomUUID } from 'node:crypto'

export interface ActiveSession {
  stored: StoredSession
  claude: ClaudeProcess | null
  state: SessionState
}

export interface SessionManager {
  store: Store

  // Session lifecycle
  listSessions: () => StoredSession[]
  getSession: (id: string) => ActiveSession | null
  createSession: (cwd: string) => ActiveSession
  getOrCreateSession: (cwd: string) => ActiveSession

  // Messaging
  sendMessage: (sessionId: string, text: string) => void
  getMessages: (sessionId: string) => ChatMessage[]

  // Events
  onMessage: (callback: (sessionId: string, message: ChatMessage) => void) => void
  onStateChange: (callback: (sessionId: string, state: SessionState) => void) => void
  onSessionReady: (callback: (sessionId: string, claudeSessionId: string) => void) => void
}

export function createSessionManager(): SessionManager {
  const store = createStore()
  const activeSessions = new Map<string, ActiveSession>()

  const messageCallbacks: Array<(sessionId: string, msg: ChatMessage) => void> = []
  const stateCallbacks: Array<(sessionId: string, state: SessionState) => void> = []
  const sessionReadyCallbacks: Array<(sessionId: string, claudeSessionId: string) => void> = []

  function setState(sessionId: string, newState: SessionState) {
    const session = activeSessions.get(sessionId)
    if (session && session.state !== newState) {
      session.state = newState
      for (const cb of stateCallbacks) {
        cb(sessionId, newState)
      }
    }
  }

  function addMessage(sessionId: string, msg: ChatMessage) {
    store.appendMessage(sessionId, msg)
    for (const cb of messageCallbacks) {
      cb(sessionId, msg)
    }
  }

  function handleClaudeMessage(sessionId: string, msg: ClaudeMessage) {
    const session = activeSessions.get(sessionId)
    if (!session) return

    // Handle system init - capture Claude's session ID
    if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
      const init = msg as { session_id: string }
      store.updateSession(sessionId, { claudeSessionId: init.session_id })
      session.stored.claudeSessionId = init.session_id

      for (const cb of sessionReadyCallbacks) {
        cb(sessionId, init.session_id)
      }
    }

    // Handle assistant messages
    if (msg.type === 'assistant') {
      setState(sessionId, 'thinking')
      const assistant = msg as {
        message: { content: Array<{ type: string; text?: string }> }
      }

      for (const content of assistant.message.content) {
        if (content.type === 'text' && content.text) {
          addMessage(sessionId, {
            id: randomUUID(),
            role: 'assistant',
            content: content.text,
            timestamp: new Date().toISOString()
          })
        }
      }
    }

    // Handle result (Claude finished processing)
    if (msg.type === 'result') {
      setState(sessionId, 'idle')
    }
  }

  function startClaude(session: ActiveSession) {
    if (session.claude) return

    const sessionId = session.stored.id
    console.log(`[session] Starting Claude for session ${sessionId}`)

    session.claude = spawnClaude({
      cwd: session.stored.cwd,
      resume: session.stored.claudeSessionId || undefined,
      onMessage: (msg) => handleClaudeMessage(sessionId, msg),
      onExit: (code) => {
        console.log(`[session] Claude exited for session ${sessionId} with code ${code}`)
        session.claude = null
        session.state = 'idle'
        store.updateSession(sessionId, { active: false })
      }
    })
  }

  function getOrLoadSession(id: string): ActiveSession | null {
    // Check if already active
    let session = activeSessions.get(id)
    if (session) return session

    // Try to load from store
    const stored = store.getSession(id)
    if (!stored) return null

    session = {
      stored,
      claude: null,
      state: 'idle'
    }
    activeSessions.set(id, session)
    return session
  }

  return {
    store,

    listSessions() {
      return store.listSessions()
    },

    getSession(id: string) {
      return getOrLoadSession(id)
    },

    createSession(cwd: string) {
      const stored = store.createSession(cwd)
      const session: ActiveSession = {
        stored,
        claude: null,
        state: 'idle'
      }
      activeSessions.set(stored.id, session)
      return session
    },

    getOrCreateSession(cwd: string) {
      // Find existing active session for this cwd
      const sessions = store.listSessions()
      const existing = sessions.find(s => s.cwd === cwd && s.active)

      if (existing) {
        return getOrLoadSession(existing.id)!
      }

      return this.createSession(cwd)
    },

    sendMessage(sessionId: string, text: string) {
      const session = getOrLoadSession(sessionId)
      if (!session) {
        console.error(`[session] Session ${sessionId} not found`)
        return
      }

      // Start Claude if not running
      if (!session.claude) {
        startClaude(session)
      }

      // Add user message
      addMessage(sessionId, {
        id: randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString()
      })

      // Send to Claude
      setState(sessionId, 'thinking')
      session.claude!.send(text)

      // Mark session as active
      store.updateSession(sessionId, { active: true })
    },

    getMessages(sessionId: string) {
      return store.getMessages(sessionId)
    },

    onMessage(callback) {
      messageCallbacks.push(callback)
    },

    onStateChange(callback) {
      stateCallbacks.push(callback)
    },

    onSessionReady(callback) {
      sessionReadyCallbacks.push(callback)
    }
  }
}
