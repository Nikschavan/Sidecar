/**
 * Query hook for fetching session metadata
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { fetchSessionMetadata } from '../lib/api'

export function useSessionMetadata(
  apiUrl: string,
  sessionId: string | null,
  onModelChange?: (model: 'default' | 'sonnet' | 'opus') => void
) {
  return useQuery({
    queryKey: sessionId ? queryKeys.sessionMetadata(sessionId) : ['sessionMetadata', null],
    queryFn: async () => {
      const data = await fetchSessionMetadata(apiUrl, sessionId!)
      // Side effect: notify parent of model change
      if (data.model && onModelChange) {
        onModelChange(data.model as 'default' | 'sonnet' | 'opus')
      }
      return data
    },
    enabled: !!sessionId,
    staleTime: 60 * 1000,
  })
}
