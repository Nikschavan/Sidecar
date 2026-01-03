/**
 * QueryClient configuration for TanStack Query
 */

import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Keep data fresh for 30 seconds
        staleTime: 30 * 1000,

        // Cache data for 5 minutes even when unused
        gcTime: 5 * 60 * 1000,

        // Retry failed requests up to 2 times
        retry: 2,

        // Refetch on window focus - fixes white screen issue!
        refetchOnWindowFocus: true,

        // Refetch when reconnecting
        refetchOnReconnect: true,

        // Refetch on mount if data is stale
        refetchOnMount: true,
      },
      mutations: {
        retry: 1,
      },
    },
  })
}
