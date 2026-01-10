/**
 * API client for Claude sessions
 * Used by TanStack Query hooks
 */

import { getAuthHeaders } from '../utils/auth'
import type { ChatMessage, ImageBlock } from '@sidecar/shared'

// Types
export interface Project {
  path: string
  name: string
  modifiedAt: string
}

export interface Session {
  id: string
  name: string | null
  modifiedAt: string
  size: number
  model: string | null
}

export interface SessionMessagesResponse {
  sessionId: string
  projectPath: string
  messageCount: number
  totalMessages: number
  offset: number
  messages: ChatMessage[]
  isActive?: boolean
  isPartial?: boolean
}

// API functions

export async function fetchProjects(apiUrl: string): Promise<Project[]> {
  const res = await fetch(`${apiUrl}/api/claude/projects`, {
    headers: getAuthHeaders()
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.projects
}

export async function fetchSessions(apiUrl: string, projectPath: string): Promise<Session[]> {
  const res = await fetch(
    `${apiUrl}/api/claude/projects/${encodeURIComponent(projectPath)}/sessions`,
    { headers: getAuthHeaders() }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.sessions
}

export async function fetchSessionMessages(
  apiUrl: string,
  sessionId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<SessionMessagesResponse> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))

  const url = `${apiUrl}/api/claude/sessions/${sessionId}${params.toString() ? `?${params}` : ''}`
  const res = await fetch(url, {
    headers: getAuthHeaders()
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchSessionMetadata(
  apiUrl: string,
  sessionId: string
): Promise<{ model?: string }> {
  const res = await fetch(`${apiUrl}/api/claude/sessions/${sessionId}/metadata`, {
    headers: getAuthHeaders()
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Mutation functions

export async function sendMessage(
  apiUrl: string,
  sessionId: string,
  payload: {
    text: string
    images?: ImageBlock[]
    permissionMode?: string
    model?: string
  }
): Promise<void> {
  const res = await fetch(`${apiUrl}/api/claude/sessions/${sessionId}/send`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function createSession(
  apiUrl: string,
  projectPath: string,
  payload: {
    text: string
    images?: ImageBlock[]
    permissionMode?: string
    model?: string
  }
): Promise<{ sessionId: string }> {
  const res = await fetch(
    `${apiUrl}/api/claude/projects/${encodeURIComponent(projectPath)}/new`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Abort a session (stop Claude processing)
 */
export async function abortSession(
  apiUrl: string,
  sessionId: string
): Promise<void> {
  const res = await fetch(`${apiUrl}/api/sessions/${sessionId}/abort`, {
    method: 'POST',
    headers: getAuthHeaders()
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/**
 * Respond to a permission request
 */
export async function respondToPermission(
  apiUrl: string,
  sessionId: string,
  payload: {
    requestId: string
    allow: boolean
    allowAll?: boolean
    toolName?: string
    updatedInput?: Record<string, unknown>
  }
): Promise<void> {
  const res = await fetch(`${apiUrl}/api/claude/sessions/${sessionId}/permission`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
