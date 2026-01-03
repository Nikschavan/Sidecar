/**
 * Query hook for fetching sessions list with manual refresh
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { fetchSessions, type Session } from '../lib/api'

export function useSessionsList(apiUrl: string, projectPath: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: projectPath ? queryKeys.sessions(projectPath) : ['sessions', null],
    queryFn: () => fetchSessions(apiUrl, projectPath!),
    enabled: !!projectPath,
    staleTime: 30 * 1000,
  })

  // Manual refresh function for the refresh button
  const refresh = () => {
    if (projectPath) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sessions(projectPath)
      })
    }
  }

  return {
    ...query,
    refresh,
  }
}

export type { Session }
