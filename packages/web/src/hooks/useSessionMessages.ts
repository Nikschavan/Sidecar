/**
 * Query hook for fetching session messages with infinite scrollback support
 */

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { queryKeys } from '../lib/queryKeys'
import { fetchSessionMessages, type SessionMessagesResponse } from '../lib/api'
import type { ChatMessage } from '@sidecar/shared'

const PAGE_SIZE = 20 // Number of messages per page

export function useSessionMessages(apiUrl: string, sessionId: string | null) {
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: sessionId ? queryKeys.messages(sessionId) : ['messages', null],
    queryFn: ({ pageParam = 0 }) => fetchSessionMessages(apiUrl, sessionId!, { limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage) => {
      // Calculate next offset for scrollback (loading older messages)
      const currentOffset = lastPage.offset
      const loadedCount = lastPage.messageCount
      const totalMessages = lastPage.totalMessages

      // If we've loaded all messages, return undefined (no more pages)
      if (currentOffset + loadedCount >= totalMessages) {
        return undefined
      }

      // Return next offset to load older messages
      return currentOffset + loadedCount
    },
    enabled: !!sessionId,
    staleTime: 30 * 1000,
    initialPageParam: 0,
  })

  // Flatten all pages into a single messages array
  const messages = useMemo(() => {
    if (!query.data) return []

    // Pages are ordered from newest to oldest as user scrolls back
    // We need to reverse to show oldest-to-newest in chat UI
    const allPages = [...query.data.pages].reverse()
    return allPages.flatMap(page => page.messages)
  }, [query.data])

  // Get metadata from the most recent page (first page loaded)
  const firstPage = query.data?.pages[0]
  const isActive = firstPage?.isActive ?? false
  const totalMessages = firstPage?.totalMessages ?? 0

  // Function to optimistically add a message (used by sendMessage mutation)
  const addOptimisticMessage = (message: ChatMessage) => {
    if (!sessionId) return

    queryClient.setQueryData(
      queryKeys.messages(sessionId),
      (old: any) => {
        if (!old) return old

        // Add to the most recent page (first page)
        const updatedPages = [...old.pages]
        if (updatedPages[0]) {
          updatedPages[0] = {
            ...updatedPages[0],
            messages: [...updatedPages[0].messages, message],
            messageCount: updatedPages[0].messageCount + 1,
          }
        }

        return {
          ...old,
          pages: updatedPages,
        }
      }
    )
  }

  // Function to remove an optimistic message on error
  const removeOptimisticMessage = (messageId: string) => {
    if (!sessionId) return

    queryClient.setQueryData(
      queryKeys.messages(sessionId),
      (old: any) => {
        if (!old) return old

        const updatedPages = old.pages.map((page: SessionMessagesResponse) => ({
          ...page,
          messages: page.messages.filter(m => m.id !== messageId),
        }))

        return {
          ...old,
          pages: updatedPages,
        }
      }
    )
  }

  // Function to update cache with WebSocket message
  const updateFromWebSocket = (message: ChatMessage) => {
    if (!sessionId) return

    queryClient.setQueryData(
      queryKeys.messages(sessionId),
      (old: any) => {
        if (!old) return old

        const updatedPages = [...old.pages]
        const firstPage = updatedPages[0]

        if (!firstPage) return old

        const exists = firstPage.messages.some((m: ChatMessage) => m.id === message.id)

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

          updatedPages[0] = {
            ...firstPage,
            messages: [...filtered, message],
            messageCount: filtered.length + 1,
          }
        }

        return {
          ...old,
          pages: updatedPages,
        }
      }
    )
  }

  return {
    ...query,
    messages,
    isActive,
    totalMessages,
    addOptimisticMessage,
    removeOptimisticMessage,
    updateFromWebSocket,
  }
}
