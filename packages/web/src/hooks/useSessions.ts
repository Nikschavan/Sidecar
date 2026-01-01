import { useState, useEffect, useCallback } from 'react'
import type { ChatMessage } from '@sidecar/shared'

interface Project {
  path: string
  name: string
  modifiedAt: string
}

interface Session {
  id: string
  name: string | null
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

interface PendingPermission {
  tool: string
  description: string
}

export function useSessions(apiUrl: string) {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)

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
        const data = await res.json()
        // Check if any response contains a tool_use that needs permission
        if (data.responses) {
          for (const response of data.responses) {
            if (response.type === 'assistant' && response.message?.content) {
              for (const block of response.message.content) {
                if (block.type === 'tool_use' && block.name) {
                  // Check if Claude is waiting (no result message received)
                  const hasResult = data.responses.some((r: { type: string }) => r.type === 'result')
                  if (!hasResult) {
                    setPendingPermission({
                      tool: block.name,
                      description: `${block.name}: ${JSON.stringify(block.input || {}).slice(0, 100)}`
                    })
                  }
                }
              }
            }
          }
        }
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
    setPendingPermission(null)
  }, [])

  // Send permission response
  const respondToPermission = useCallback(async (allow: boolean, always?: boolean) => {
    if (!currentSessionId || !pendingPermission) return

    try {
      await fetch(apiUrl + '/api/claude/sessions/' + currentSessionId + '/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: pendingPermission.tool,
          allow,
          always
        })
      })
      setPendingPermission(null)
      // Refresh messages to see result
      await fetchMessages()
    } catch (e) {
      console.error('Failed to respond to permission:', e)
    }
  }, [apiUrl, currentSessionId, pendingPermission, fetchMessages])

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
    pendingPermission,
    sendMessage,
    selectProject,
    selectSession,
    respondToPermission,
    refresh: fetchMessages
  }
}
