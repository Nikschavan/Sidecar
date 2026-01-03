/**
 * Query hook for fetching projects list
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryKeys'
import { fetchProjects, type Project } from '../lib/api'

export function useProjects(apiUrl: string) {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => fetchProjects(apiUrl),
    staleTime: 60 * 1000, // Projects change less frequently
  })
}

export type { Project }
