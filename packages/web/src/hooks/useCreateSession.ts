/**
 * Mutation hook for creating new sessions
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { createSession } from '../lib/api'
import type { ImageBlock } from '@sidecar/shared'
import type { SessionSettings } from '../components/InputBar'

interface CreateSessionParams {
  text: string
  images?: ImageBlock[]
}

export function useCreateSession(
  apiUrl: string,
  projectPath: string | null,
  settings?: SessionSettings
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ text, images }: CreateSessionParams) => {
      if (!projectPath) throw new Error('No project selected')

      return createSession(apiUrl, projectPath, {
        text,
        images,
        permissionMode: settings?.permissionMode !== 'default'
          ? settings?.permissionMode
          : undefined,
        model: settings?.model !== 'default' ? settings?.model : undefined,
      })
    },

    onSuccess: () => {
      // Invalidate sessions list to show new session
      if (projectPath) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.sessions(projectPath)
        })
      }
    },
  })
}
