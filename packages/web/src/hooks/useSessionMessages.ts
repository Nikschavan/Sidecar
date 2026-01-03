/**
 * Query hook for fetching session messages with cache update helpers
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { fetchSessionMessages, type SessionMessagesResponse } from '../lib/api'
import type { ChatMessage } from '@sidecar/shared'

export function useSessionMessages(apiUrl: string, sessionId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: sessionId ? queryKeys.messages(sessionId) : ['messages', null],
    queryFn: () => fetchSessionMessages(apiUrl, sessionId!),
    enabled: !!sessionId,
    staleTime: 30 * 1000,
  })

  // Function to optimistically add a message (used by sendMessage mutation)
  const addOptimisticMessage = (message: ChatMessage) => {
    if (!sessionId) return

    queryClient.setQueryData<SessionMessagesResponse>(
      queryKeys.messages(sessionId),
      (old) => {
        if (!old) return old
        return {
          ...old,
          messages: [...old.messages, message],
        }
      }
    )
  }

  // Function to remove an optimistic message on error
  const removeOptimisticMessage = (messageId: string) => {
    if (!sessionId) return

    queryClient.setQueryData<SessionMessagesResponse>(
      queryKeys.messages(sessionId),
      (old) => {
        if (!old) return old
        return {
          ...old,
          messages: old.messages.filter(m => m.id !== messageId),
        }
      }
    )
  }

  // Function to update cache with WebSocket message
  const updateFromWebSocket = (message: ChatMessage) => {
    if (!sessionId) return

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
  }

  return {
    ...query,
    messages: query.data?.messages ?? [],
    isActive: query.data?.isActive ?? false,
    addOptimisticMessage,
    removeOptimisticMessage,
    updateFromWebSocket,
  }
}
