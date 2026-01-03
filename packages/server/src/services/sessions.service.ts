/**
 * Sessions Service
 *
 * Manages Sidecar sessions (wraps session manager)
 */

import { createSessionManager, type ActiveSession } from '../session/manager.js'
import type { ChatMessage, SessionState } from '@sidecar/shared'

/**
 * Sessions Service - manages Sidecar sessions
 */
export class SessionsService {
  private sessionManager = createSessionManager()

  /**
   * Register a message handler
   */
  onMessage(handler: (sessionId: string, message: ChatMessage) => void): void {
    this.sessionManager.onMessage(handler)
  }

  /**
   * Register a state change handler
   */
  onStateChange(handler: (sessionId: string, state: SessionState) => void): void {
    this.sessionManager.onStateChange(handler)
  }

  /**
   * Register a session ready handler
   */
  onSessionReady(handler: (sessionId: string, claudeSessionId: string) => void): void {
    this.sessionManager.onSessionReady(handler)
  }

  /**
   * List all sessions
   */
  listSessions(): Array<{ id: string; createdAt: string; cwd: string }> {
    return this.sessionManager.listSessions()
  }

  /**
   * Create a new session
   */
  createSession(cwd: string): ActiveSession {
    return this.sessionManager.createSession(cwd)
  }

  /**
   * Get or create a session for a cwd
   */
  getOrCreateSession(cwd: string): ActiveSession {
    return this.sessionManager.getOrCreateSession(cwd)
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): ActiveSession | null {
    return this.sessionManager.getSession(sessionId)
  }

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string): ChatMessage[] {
    return this.sessionManager.getMessages(sessionId)
  }

  /**
   * Send a message to a session
   */
  sendMessage(sessionId: string, text: string): void {
    this.sessionManager.sendMessage(sessionId, text)
  }
}

// Singleton instance
export const sessionsService = new SessionsService()
