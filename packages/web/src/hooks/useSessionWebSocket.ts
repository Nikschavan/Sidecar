/**
 * WebSocket hook that updates React Query cache
 */

import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { getAuthenticatedWsUrl } from '../utils/auth'
import type { ChatMessage } from '@sidecar/shared'
import type { SessionMessagesResponse } from '../lib/api'

export interface PendingPermission {
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

interface UseSessionWebSocketOptions {
  apiUrl: string
  currentSessionId: string | null
  onPermissionRequest: (permission: PendingPermission) => void
  onPermissionResolved: (toolId: string) => void
  onSessionAborted: () => void
  onProcessingComplete: () => void
  onToolResolved?: (toolUseId: string) => void
}

export function useSessionWebSocket({
  apiUrl,
  currentSessionId,
  onPermissionRequest,
  onPermissionResolved,
  onSessionAborted,
  onProcessingComplete,
  onToolResolved,
}: UseSessionWebSocketOptions) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const isUnmountedRef = useRef(false)
  const currentSessionIdRef = useRef(currentSessionId)

  // Store callbacks in refs to avoid reconnecting when they change
  const onPermissionRequestRef = useRef(onPermissionRequest)
  const onPermissionResolvedRef = useRef(onPermissionResolved)
  const onSessionAbortedRef = useRef(onSessionAborted)
  const onProcessingCompleteRef = useRef(onProcessingComplete)
  const onToolResolvedRef = useRef(onToolResolved)

  // Convert HTTP URL to WebSocket URL and append /ws path
  const wsUrl = apiUrl.replace('http', 'ws') + '/ws'

  // Keep refs in sync
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
    onPermissionRequestRef.current = onPermissionRequest
    onPermissionResolvedRef.current = onPermissionResolved
    onSessionAbortedRef.current = onSessionAborted
    onProcessingCompleteRef.current = onProcessingComplete
    onToolResolvedRef.current = onToolResolved
  }, [currentSessionId, onPermissionRequest, onPermissionResolved, onSessionAborted, onProcessingComplete, onToolResolved])

  // Update React Query cache from WebSocket message
  const updateMessagesCache = useCallback((message: ChatMessage, sessionId: string) => {
    queryClient.setQueryData<SessionMessagesResponse>(
      queryKeys.messages(sessionId),
      (old) => {
        if (!old) return old

        const exists = old.messages.some(m => m.id === message.id)
        if (exists) {
          // Update existing message (streaming updates)
          return {
            ...old,
            messages: old.messages.map(m =>
              m.id === message.id ? message : m
            ),
          }
        }

        // Remove temp messages when receiving real user message
        if (message.role === 'user') {
          const filtered = old.messages.filter(m => !m.id?.startsWith('temp-'))
          return {
            ...old,
            messages: [...filtered, message],
          }
        }

        return {
          ...old,
          messages: [...old.messages, message],
        }
      }
    )
  }, [queryClient])

  // WebSocket connection
  useEffect(() => {
    isUnmountedRef.current = false

    const connect = () => {
      if (isUnmountedRef.current) return

      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      console.log('[WebSocket] Connecting...')
      const ws = new WebSocket(getAuthenticatedWsUrl(wsUrl))
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[WebSocket] Connected')
        if (currentSessionIdRef.current) {
          ws.send(JSON.stringify({
            type: 'watch_session',
            sessionId: currentSessionIdRef.current
          }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const sessionId = currentSessionIdRef.current

          // Handle permission request
          if (msg.type === 'permission_request' && msg.sessionId === sessionId) {
            onPermissionRequestRef.current({
              requestId: msg.requestId,
              sessionId: msg.sessionId,
              toolName: msg.toolName,
              toolUseId: msg.toolUseId,
              input: msg.input,
              permissionSuggestions: msg.permissionSuggestions,
              source: msg.source
            })
          }

          // Handle permission resolved
          if (msg.type === 'permission_resolved' && msg.sessionId === sessionId) {
            onPermissionResolvedRef.current(msg.toolId)
          }

          // Handle session aborted
          if (msg.type === 'session_aborted' && msg.sessionId === sessionId) {
            onSessionAbortedRef.current()
          }

          // Handle claude message - update React Query cache
          if (msg.type === 'claude_message' && msg.message && sessionId && msg.sessionId === sessionId) {
            updateMessagesCache(msg.message, sessionId)

            // Check if Claude finished processing
            if (msg.message.type === 'result') {
              onProcessingCompleteRef.current()
            }

            // Check if tool call was resolved
            const toolCalls = msg.message.toolCalls as Array<{ id: string; result?: string }> | undefined
            if (toolCalls && onToolResolvedRef.current) {
              for (const tool of toolCalls) {
                if (tool.result !== undefined) {
                  onToolResolvedRef.current(tool.id)
                }
              }
            }
          }
        } catch (e) {
          console.error('[WebSocket] Failed to parse message:', e)
        }
      }

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected')
        if (!isUnmountedRef.current && wsRef.current === ws) {
          reconnectTimeoutRef.current = window.setTimeout(connect, 2000)
        }
      }

      ws.onerror = (err) => {
        console.error('[WebSocket] Error:', err)
      }
    }

    connect()

    return () => {
      isUnmountedRef.current = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [wsUrl, updateMessagesCache])

  // Send watch_session when session changes
  useEffect(() => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN && currentSessionId) {
      ws.send(JSON.stringify({ type: 'watch_session', sessionId: currentSessionId }))
    }
  }, [currentSessionId])

  // Return functions to send messages through WebSocket
  const sendPermissionResponse = useCallback((
    permission: PendingPermission,
    allow: boolean,
    options?: { answers?: Record<string, string[]>; allowAll?: boolean }
  ) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      let updatedInput = allow ? permission.input : undefined
      if (allow && options?.answers) {
        updatedInput = { ...permission.input, answers: options.answers }
      }

      ws.send(JSON.stringify({
        type: 'permission_response',
        sessionId: permission.sessionId,
        requestId: permission.requestId,
        toolName: permission.toolName,
        allow,
        allowAll: options?.allowAll || false,
        updatedInput,
        answers: options?.answers
      }))
    }
  }, [])

  const sendAbortRequest = useCallback((sessionId: string) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'abort_session',
        sessionId
      }))
    }
  }, [])

  return {
    sendPermissionResponse,
    sendAbortRequest,
  }
}
