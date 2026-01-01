import { useState, useEffect, useCallback } from 'react'
import type { ChatMessage } from '@sidecar/shared'

interface Project {
  path: string
  name: string
  modifiedAt: string
}

interface Session {
  id: string
  modifiedAt: string
  size: number
}

interface ProjectsResponse {
  projects: Project[]
}

interface SessionsResponse {
  projectPath: string
  sessions: Session[]
}

interface SessionMessagesResponse {
  sessionId: string
  projectPath: string
  messageCount: number
  messages: ChatMessage[]
}

export function useSessions(apiUrl: string) {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  // Fetch all projects
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + '/api/claude/projects')
      const data: ProjectsResponse = await res.json()
      setProjects(data.projects)
      // Auto-select first (most recent) project
      if (data.projects.length > 0 && !currentProject) {
        setCurrentProject(data.projects[0].path)
      }
    } catch (e) {
      console.error('Failed to fetch projects:', e)
    }
  }, [apiUrl, currentProject])

  // Fetch sessions for current project
  const fetchSessions = useCallback(async () => {
    if (!currentProject) return
    try {
      const res = await fetch(apiUrl + '/api/claude/projects/' + encodeURIComponent(currentProject) + '/sessions')
      const data: SessionsResponse = await res.json()
      setSessions(data.sessions)
      // Auto-select first (most recent) session
      if (data.sessions.length > 0 && !currentSessionId) {
        setCurrentSessionId(data.sessions[0].id)
      }
    } catch (e) {
      console.error('Failed to fetch sessions:', e)
    }
  }, [apiUrl, currentProject, currentSessionId])

  // Fetch messages for current session
  const fetchMessages = useCallback(async () => {
    if (!currentSessionId) return
    
    setLoading(true)
    try {
      const res = await fetch(apiUrl + '/api/claude/sessions/' + currentSessionId)
      const data: SessionMessagesResponse = await res.json()
      setMessages(data.messages)
    } catch (e) {
      console.error('Failed to fetch messages:', e)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, currentSessionId])

  // Send message to current session
  const sendMessage = useCallback(async (text: string) => {
    if (!currentSessionId || sending) return

    setSending(true)
    
    // Optimistically add user message
    const tempId = 'temp-' + String(Math.random()).slice(2)
    const tempMessage: ChatMessage = {
      id: tempId,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, tempMessage])

    try {
      const res = await fetch(apiUrl + '/api/claude/sessions/' + currentSessionId + '/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      
      if (res.ok) {
        // Refresh messages to get Claude's response
        await fetchMessages()
      }
    } catch (e) {
      console.error('Failed to send message:', e)
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== tempId))
    } finally {
      setSending(false)
    }
  }, [apiUrl, currentSessionId, sending, fetchMessages])

  // Select a project
  const selectProject = useCallback((projectPath: string) => {
    setCurrentProject(projectPath)
    setCurrentSessionId(null)
    setSessions([])
    setMessages([])
  }, [])

  // Select a session
  const selectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId)
    setMessages([])
  }, [])

  // Initial fetch - load projects
  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Fetch sessions when project changes
  useEffect(() => {
    if (currentProject) {
      fetchSessions()
    }
  }, [currentProject, fetchSessions])

  // Fetch messages when session changes
  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  // Poll for updates every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!sending) {
        fetchMessages()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [fetchMessages, sending])

  return {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    messages,
    loading,
    sending,
    sendMessage,
    selectProject,
    selectSession,
    refresh: fetchMessages
  }
}
