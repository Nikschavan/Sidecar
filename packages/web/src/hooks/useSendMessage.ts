/**
 * Mutation hook for sending messages with optimistic updates
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { sendMessage, type SessionMessagesResponse } from '../lib/api'
import type { ChatMessage, ContentBlock, ImageBlock } from '@sidecar/shared'
import type { SessionSettings } from '../components/InputBar'

interface SendMessageParams {
  text: string
  images?: ImageBlock[]
}

export function useSendMessage(
  apiUrl: string,
  sessionId: string | null,
  settings?: SessionSettings
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ text, images }: SendMessageParams) => {
      if (!sessionId) throw new Error('No session selected')

      await sendMessage(apiUrl, sessionId, {
        text,
        images,
        permissionMode: settings?.permissionMode !== 'default'
          ? settings?.permissionMode
          : undefined,
        model: settings?.model !== 'default' ? settings?.model : undefined,
      })
    },

    onMutate: async ({ text, images }) => {
      if (!sessionId) return

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.messages(sessionId)
      })

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<SessionMessagesResponse>(
        queryKeys.messages(sessionId)
      )

      // Create optimistic message
      const content: ContentBlock[] = []
      if (text) content.push(text)
      if (images) content.push(...images)

      const tempId = 'temp-' + String(Math.random()).slice(2)
      const tempMessage: ChatMessage = {
        id: tempId,
        role: 'user',
        content,
        timestamp: new Date().toISOString()
      }

      // Optimistically add message
      queryClient.setQueryData<SessionMessagesResponse>(
        queryKeys.messages(sessionId),
        (old) => {
          if (!old) return old
          return {
            ...old,
            messages: [...old.messages, tempMessage],
          }
        }
      )

      return { previousMessages, tempId }
    },

    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousMessages && sessionId) {
        queryClient.setQueryData(
          queryKeys.messages(sessionId),
          context.previousMessages
        )
      }
    },

    // Don't refetch - WebSocket handles real-time updates
    onSettled: () => {},
  })
}
