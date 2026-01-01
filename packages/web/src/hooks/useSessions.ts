import { useState, useEffect, useCallback, useRef } from 'react'
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
  requestId: string
  sessionId: string
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  permissionSuggestions?: Array<{
    type: string
    mode?: string
    destination?: string
  }>
  source?: 'process' | 'file'
}

export interface SlashCommand {
  command: string
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
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  // WebSocket URL from API URL
  const wsUrl = apiUrl.replace('http', 'ws')

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
        // Permission requests will come via WebSocket
        // Just refresh messages to get Claude's response
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

  // Fetch slash commands for a session
  const fetchSlashCommands = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/claude/sessions/${sessionId}/commands`)
      const data = await res.json()
      setSlashCommands(data.commands || [])
    } catch (e) {
      console.error('Failed to fetch slash commands:', e)
    }
  }, [apiUrl])

  // Select a session
  const selectSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId)
    setMessages([])
    setPendingPermission(null)

    // Fetch messages for this session directly (don't rely on useEffect)
    setLoading(true)
    try {
      const res = await fetch(apiUrl + '/api/claude/sessions/' + sessionId)
      const data: SessionMessagesResponse = await res.json()
      setMessages(data.messages)
    } catch (e) {
      console.error('Failed to fetch messages:', e)
    } finally {
      setLoading(false)
    }

    // Fetch slash commands for this session
    fetchSlashCommands(sessionId)

    // Tell server to watch this session for file-based permissions
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'watch_session', sessionId }))
    }
  }, [apiUrl, fetchSlashCommands])

  // Send permission response via WebSocket
  const respondToPermission = useCallback(async (allow: boolean, options?: { answers?: Record<string, string[]>; allowAll?: boolean }) => {
    if (!pendingPermission) return

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      // For AskUserQuestion, include answers in the updatedInput
      let updatedInput = allow ? pendingPermission.input : undefined
      if (allow && options?.answers) {
        updatedInput = { ...pendingPermission.input, answers: options.answers }
      }

      // Send via WebSocket
      ws.send(JSON.stringify({
        type: 'permission_response',
        sessionId: pendingPermission.sessionId,
        requestId: pendingPermission.requestId,
        toolName: pendingPermission.toolName,
        allow,
        allowAll: options?.allowAll || false,
        updatedInput,
        answers: options?.answers  // Also send answers separately for clarity
      }))
      setPendingPermission(null)
    } else {
      console.error('WebSocket not connected')
    }
  }, [pendingPermission])

  // WebSocket connection for real-time permission requests
  useEffect(() => {
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[useSessions] WebSocket connected')
      // If we have a current session, tell server to watch it
      if (currentSessionId) {
        ws.send(JSON.stringify({ type: 'watch_session', sessionId: currentSessionId }))
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        // Handle permission request from server
        if (msg.type === 'permission_request') {
          // Only show permission dialogs for the current session
          if (msg.sessionId === currentSessionId) {
            console.log('[useSessions] Permission request:', msg.toolName, msg.input, 'source:', msg.source)
            setPendingPermission({
              requestId: msg.requestId,
              sessionId: msg.sessionId,
              toolName: msg.toolName,
              toolUseId: msg.toolUseId,
              input: msg.input,
              permissionSuggestions: msg.permissionSuggestions,
              source: msg.source
            })
          } else {
            console.log('[useSessions] Ignoring permission request for different session:', msg.sessionId, '(current:', currentSessionId, ')')
          }
        }

        // Handle claude message - append to existing messages instead of full refetch
        // Only update if message is for the current session
        if (msg.type === 'claude_message' && msg.message && (!msg.sessionId || msg.sessionId === currentSessionId)) {
          setMessages(prev => {
            // Check if message already exists (by id) to avoid duplicates
            const exists = prev.some(m => m.id === msg.message.id)
            if (exists) {
              // Update existing message (for streaming updates)
              return prev.map(m => m.id === msg.message.id ? msg.message : m)
            }
            return [...prev, msg.message]
          })
        }
      } catch (e) {
        console.error('[useSessions] Failed to parse message:', e)
      }
    }

    ws.onclose = () => {
      console.log('[useSessions] WebSocket disconnected')
    }

    ws.onerror = (err) => {
      console.error('[useSessions] WebSocket error:', err)
    }

    return () => {
      ws.close()
    }
  }, [wsUrl, currentSessionId])

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

  // No polling needed - selectSession fetches messages directly, WebSocket handles real-time updates

  return {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    messages,
    loading,
    sending,
    pendingPermission,
    slashCommands,
    sendMessage,
    selectProject,
    selectSession,
    respondToPermission,
    refresh: fetchMessages
  }
}
