/**
 * SSE hook that updates React Query cache
 *
 * Replaces WebSocket with Server-Sent Events for real-time updates.
 * Client-to-server actions are performed via REST API calls.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { getAuthenticatedSseUrl } from '../utils/auth'
import { abortSession, respondToPermission } from '../lib/api'
import type { ChatMessage } from '@sidecar/shared'

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

interface UseSessionSSEOptions {
  apiUrl: string
  currentSessionId: string | null
  onPermissionRequest: (permission: PendingPermission) => void
  onPermissionResolved: (toolId: string) => void
  onSessionAborted: () => void
  onProcessingComplete: () => void
  onToolResolved?: (toolUseId: string) => void
}

export function useSessionSSE({
  apiUrl,
  currentSessionId,
  onPermissionRequest,
  onPermissionResolved,
  onSessionAborted,
  onProcessingComplete,
  onToolResolved,
}: UseSessionSSEOptions) {
  const queryClient = useQueryClient()
  const eventSourceRef = useRef<EventSource | null>(null)

  // Store callbacks in refs to avoid reconnecting when they change
  const onPermissionRequestRef = useRef(onPermissionRequest)
  const onPermissionResolvedRef = useRef(onPermissionResolved)
  const onSessionAbortedRef = useRef(onSessionAborted)
  const onProcessingCompleteRef = useRef(onProcessingComplete)
  const onToolResolvedRef = useRef(onToolResolved)

  // Keep callback refs in sync
  useEffect(() => {
    onPermissionRequestRef.current = onPermissionRequest
    onPermissionResolvedRef.current = onPermissionResolved
    onSessionAbortedRef.current = onSessionAborted
    onProcessingCompleteRef.current = onProcessingComplete
    onToolResolvedRef.current = onToolResolved
  }, [onPermissionRequest, onPermissionResolved, onSessionAborted, onProcessingComplete, onToolResolved])

  // Update React Query cache from SSE message (for infinite query)
  const updateMessagesCache = useCallback((message: ChatMessage, sessionId: string) => {
    queryClient.setQueryData(
      queryKeys.messages(sessionId),
      (old: any) => {
        // Initialize cache if it doesn't exist (hook-based sessions)
        if (!old) {
          return {
            pages: [{
              sessionId,
              projectPath: '',  // Will be populated on next fetch
              messageCount: 1,
              totalMessages: 1,
              offset: 0,
              messages: [message],
              isActive: true,
              isPartial: false,
            }],
            pageParams: [0],
          }
        }

        // Update the first page (most recent messages)
        const updatedPages = [...old.pages]
        const firstPage = updatedPages[0]

        if (!firstPage) return old

        // Skip check if message has no ID (system messages) - always add them
        const messageId = message.id
        const exists = messageId ? firstPage.messages.some((m: ChatMessage) => m.id === messageId) : false

        if (exists) {
          // Update existing message (streaming updates)
          updatedPages[0] = {
            ...firstPage,
            messages: firstPage.messages.map((m: ChatMessage) =>
              m.id === message.id ? message : m
            ),
          }
        } else {
          // Remove temp messages when receiving real user message
          let filtered = firstPage.messages
          if (message.role === 'user') {
            filtered = firstPage.messages.filter((m: ChatMessage) => !m.id?.startsWith('temp-'))
          }

          // Add new message and sort by timestamp to ensure correct order
          // ISO timestamps sort correctly as strings
          const newMessages = [...filtered, message].sort((a, b) =>
            a.timestamp.localeCompare(b.timestamp)
          )

          updatedPages[0] = {
            ...firstPage,
            messages: newMessages,
            messageCount: filtered.length + 1,
            totalMessages: firstPage.totalMessages + 1,
          }
        }

        return {
          ...old,
          pages: updatedPages,
        }
      }
    )
  }, [queryClient])

  // SSE connection - reconnects when session changes
  useEffect(() => {
    if (!currentSessionId) {
      // No session, close connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      return
    }

    // Session changed, need to reconnect
    const sseUrl = `${apiUrl}/api/events/${currentSessionId}`

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const eventSource = new EventSource(getAuthenticatedSseUrl(sseUrl))
    eventSourceRef.current = eventSource

    eventSource.addEventListener('connected', () => {
      // Connected to new session
    })

    eventSource.addEventListener('heartbeat', () => {
      // Heartbeat received
    })

    eventSource.addEventListener('claude_message', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.sessionId !== currentSessionId) {
          return
        }

        const message = data.message

        // Result messages are status updates, not chat messages - don't add to cache
        if (message.type === 'result') {
          onProcessingCompleteRef.current()
          return
        }

        // Only add valid chat messages to cache (must have id and role)
        if (message.id && message.role) {
          updateMessagesCache(message, currentSessionId)
        }

        const toolCalls = message.toolCalls as Array<{ id: string; result?: string }> | undefined
        if (toolCalls && onToolResolvedRef.current) {
          for (const tool of toolCalls) {
            if (tool.result !== undefined) {
              onToolResolvedRef.current(tool.id)
            }
          }
        }
      } catch (e) {
        console.error('[SSE] Failed to parse claude_message:', e)
      }
    })

    eventSource.addEventListener('permission_request', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.sessionId !== currentSessionId) return

        onPermissionRequestRef.current({
          requestId: data.requestId,
          sessionId: data.sessionId,
          toolName: data.toolName,
          toolUseId: data.toolUseId,
          input: data.input,
          permissionSuggestions: data.permissionSuggestions,
          source: data.source
        })
      } catch (e) {
        console.error('[SSE] Failed to parse permission_request:', e)
      }
    })

    eventSource.addEventListener('permission_resolved', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.sessionId !== currentSessionId) return

        onPermissionResolvedRef.current(data.toolId)
      } catch (e) {
        console.error('[SSE] Failed to parse permission_resolved:', e)
      }
    })

    eventSource.addEventListener('session_aborted', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.sessionId !== currentSessionId) return

        onSessionAbortedRef.current()
      } catch (e) {
        console.error('[SSE] Failed to parse session_aborted:', e)
      }
    })

    eventSource.onerror = () => {
      console.log('[SSE] Disconnected from session')
    }

    // Cleanup on unmount or session change
    return () => {
      eventSource.close()
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null
      }
    }
  }, [apiUrl, currentSessionId, updateMessagesCache])

  // Send permission response via REST API
  const sendPermissionResponse = useCallback(async (
    permission: PendingPermission,
    allow: boolean,
    options?: { answers?: Record<string, string[]>; allowAll?: boolean }
  ) => {
    let updatedInput = allow ? permission.input : undefined
    if (allow && options?.answers) {
      updatedInput = { ...permission.input, answers: options.answers }
    }

    try {
      await respondToPermission(apiUrl, permission.sessionId, {
        requestId: permission.requestId,
        allow,
        allowAll: options?.allowAll,
        toolName: permission.toolName,
        updatedInput
      })
    } catch (err) {
      console.error('[SSE] Failed to send permission response:', err)
      throw err
    }
  }, [apiUrl])

  // Send abort request via REST API
  const sendAbortRequest = useCallback(async (sessionId: string) => {
    try {
      await abortSession(apiUrl, sessionId)
    } catch (err) {
      console.error('[SSE] Failed to send abort request:', err)
      throw err
    }
  }, [apiUrl])

  return {
    sendPermissionResponse,
    sendAbortRequest,
  }
}
