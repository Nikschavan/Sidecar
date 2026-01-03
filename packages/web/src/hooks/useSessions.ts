import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage, ImageBlock, ContentBlock } from '@sidecar/shared'
import type { SessionSettings } from '../components/InputBar'

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
  model: string | null
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
  isActive?: boolean
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

export function useSessions(apiUrl: string, settings?: SessionSettings, onModelChange?: (model: 'default' | 'sonnet' | 'opus') => void) {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false) // Tracks when Claude is actively working
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const isUnmountedRef = useRef(false)

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
  const sendMessage = useCallback(async (text: string, images?: ImageBlock[]) => {
    if (!currentSessionId || sending) return

    setSending(true)
    setIsProcessing(true)

    // Build content array with text and images
    const content: ContentBlock[] = []
    if (text) content.push(text)
    if (images) content.push(...images)

    // Optimistically add user message
    const tempId = 'temp-' + String(Math.random()).slice(2)
    const tempMessage: ChatMessage = {
      id: tempId,
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, tempMessage])

    try {
      const res = await fetch(apiUrl + '/api/claude/sessions/' + currentSessionId + '/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          images,
          permissionMode: settings?.permissionMode !== 'default' ? settings?.permissionMode : undefined,
          model: settings?.model !== 'default' ? settings?.model : undefined
        })
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
  }, [apiUrl, currentSessionId, sending, fetchMessages, settings])

  // Select a project
  const selectProject = useCallback((projectPath: string) => {
    setCurrentProject(projectPath)
    setCurrentSessionId(null)
    setSessions([])
    setMessages([])
  }, [])

  // Create a new session with an initial message
  const createSession = useCallback(async (text: string, images?: ImageBlock[]): Promise<string | null> => {
    if (!currentProject || sending) return null

    setSending(true)
    setIsProcessing(true)
    setMessages([])

    // Build content array with text and images
    const content: ContentBlock[] = []
    if (text) content.push(text)
    if (images) content.push(...images)

    // Optimistically add user message
    const tempId = 'temp-' + String(Math.random()).slice(2)
    const tempMessage: ChatMessage = {
      id: tempId,
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    }
    setMessages([tempMessage])

    try {
      const res = await fetch(
        apiUrl + '/api/claude/projects/' + encodeURIComponent(currentProject) + '/new',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            images,
            permissionMode: settings?.permissionMode !== 'default' ? settings?.permissionMode : undefined,
            model: settings?.model !== 'default' ? settings?.model : undefined
          })
        }
      )

      if (res.ok) {
        const data = await res.json()
        const newSessionId = data.sessionId
        console.log('[useSessions] Created session:', newSessionId)

        // Return immediately - let the navigation handle loading the session
        return newSessionId
      }
      console.error('[useSessions] Failed to create session:', res.status)
      return null
    } catch (e) {
      console.error('Failed to create session:', e)
      setMessages([])
      return null
    } finally {
      setSending(false)
    }
  }, [apiUrl, currentProject, sending, settings])

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

  // Fetch session metadata (model, etc.)
  const fetchSessionMetadata = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/claude/sessions/${sessionId}/metadata`)
      const data = await res.json()
      if (data.model && onModelChange) {
        onModelChange(data.model)
      }
    } catch (e) {
      console.error('Failed to fetch session metadata:', e)
    }
  }, [apiUrl, onModelChange])

  // Select a session
  const selectSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId)
    setMessages([])
    setPendingPermission(null)
    setIsProcessing(false)

    // Fetch messages for this session directly (don't rely on useEffect)
    setLoading(true)
    try {
      const res = await fetch(apiUrl + '/api/claude/sessions/' + sessionId)
      const data: SessionMessagesResponse = await res.json()
      setMessages(data.messages)
      // Set isProcessing if server indicates session is active
      if (data.isActive) {
        console.log('[useSessions] Session is active, showing stop button')
        setIsProcessing(true)
      }
    } catch (e) {
      console.error('Failed to fetch messages:', e)
    } finally {
      setLoading(false)
    }

    // Fetch slash commands and metadata for this session
    fetchSlashCommands(sessionId)
    fetchSessionMetadata(sessionId)

    // Tell server to watch this session for file-based permissions
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'watch_session', sessionId }))
    }
  }, [apiUrl, fetchSlashCommands, fetchSessionMetadata])

  // Abort current Claude processing (like Ctrl+C)
  const abortSession = useCallback(() => {
    if (!currentSessionId) return

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[useSessions] Sending abort request for session:', currentSessionId)
      ws.send(JSON.stringify({
        type: 'abort_session',
        sessionId: currentSessionId
      }))
      // Optimistically clear sending/processing state
      setSending(false)
      setIsProcessing(false)
    }
  }, [currentSessionId])

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

  // Track current session ID in a ref for use in WebSocket handlers
  const currentSessionIdRef = useRef(currentSessionId)
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  // WebSocket connection for real-time permission requests
  // Only reconnect when wsUrl changes, not on session changes
  useEffect(() => {
    isUnmountedRef.current = false

    const connect = () => {
      // Don't reconnect if unmounted
      if (isUnmountedRef.current) return

      // Close existing connection if any
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      console.log('[useSessions] WebSocket connecting...')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[useSessions] WebSocket connected')
        // If we have a current session, tell server to watch it
        if (currentSessionIdRef.current) {
          ws.send(JSON.stringify({ type: 'watch_session', sessionId: currentSessionIdRef.current }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const sessionId = currentSessionIdRef.current

          // Handle permission request from server
          if (msg.type === 'permission_request') {
            // Only show permission dialogs for the current session
            if (msg.sessionId === sessionId) {
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
              console.log('[useSessions] Ignoring permission request for different session:', msg.sessionId, '(current:', sessionId, ')')
            }
          }

          // Handle permission resolved from server (permission was handled in terminal)
          if (msg.type === 'permission_resolved') {
            if (msg.sessionId === sessionId) {
              console.log('[useSessions] Permission resolved (handled in terminal):', msg.toolId)
              setPendingPermission(prev => {
                // Clear if the resolved tool matches our pending permission
                if (prev && (prev.toolUseId === msg.toolId || prev.requestId === msg.toolId)) {
                  return null
                }
                return prev
              })
            }
          }

          // Handle session aborted (Ctrl+C equivalent)
          if (msg.type === 'session_aborted') {
            if (msg.sessionId === sessionId) {
              console.log('[useSessions] Session aborted:', msg.sessionId)
              setSending(false)
              setIsProcessing(false)
              setPendingPermission(null)
            }
          }

          // Handle claude message - append to existing messages instead of full refetch
          // Only update if message is for the current session
          if (msg.type === 'claude_message' && msg.message && (!msg.sessionId || msg.sessionId === sessionId)) {
            // Check if Claude finished processing (result message type)
            const claudeMsg = msg.message as { type?: string }
            if (claudeMsg.type === 'result') {
              console.log('[useSessions] Claude finished processing (result message)')
              setIsProcessing(false)
            }

            // Check if the pending permission's tool call now has a result
            // This means permission was handled elsewhere (e.g., terminal)
            setPendingPermission(prev => {
              if (prev && prev.sessionId === sessionId && prev.toolUseId) {
                // Check if this message contains the tool call with a result
                const toolCalls = msg.message.toolCalls as Array<{ id: string; result?: string }> | undefined
                const resolvedTool = toolCalls?.find(t => t.id === prev.toolUseId && t.result !== undefined)
                if (resolvedTool) {
                  console.log('[useSessions] Tool call resolved, clearing pending permission (handled elsewhere)')
                  return null
                }
              }
              return prev
            })

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
        // Auto-reconnect after 2 seconds if:
        // - not unmounted
        // - this is still the current WebSocket (not replaced by a new one)
        if (!isUnmountedRef.current && wsRef.current === ws) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect()
          }, 2000)
        }
      }

      ws.onerror = (err) => {
        console.error('[useSessions] WebSocket error:', err)
      }
    }

    connect()

    return () => {
      isUnmountedRef.current = true
      // Clear any pending reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [wsUrl])

  // Send watch_session message when session changes (without reconnecting WebSocket)
  useEffect(() => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN && currentSessionId) {
      ws.send(JSON.stringify({ type: 'watch_session', sessionId: currentSessionId }))
    }
  }, [currentSessionId])

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

  // Clear messages for new session screen
  const clearForNewSession = useCallback(() => {
    setCurrentSessionId(null)
    setMessages([])
  }, [])

  return {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    messages,
    loading,
    sending,
    isProcessing,
    pendingPermission,
    slashCommands,
    sendMessage,
    createSession,
    selectProject,
    selectSession,
    respondToPermission,
    abortSession,
    clearForNewSession,
    refresh: fetchMessages
  }
}
