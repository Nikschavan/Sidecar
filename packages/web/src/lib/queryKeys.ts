/**
 * Query key factory for TanStack Query
 * Hierarchical keys enable targeted cache invalidation
 */

export const queryKeys = {
  // All projects
  projects: ['projects'] as const,

  // Sessions for a specific project
  sessions: (projectPath: string) => ['sessions', projectPath] as const,

  // All sessions (for invalidating all session queries)
  allSessions: ['sessions'] as const,

  // Messages for a specific session
  messages: (sessionId: string) => ['messages', sessionId] as const,

  // All messages (for bulk invalidation)
  allMessages: ['messages'] as const,

  // Session metadata
  sessionMetadata: (sessionId: string) => ['sessionMetadata', sessionId] as const,
}
