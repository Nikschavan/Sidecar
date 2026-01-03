/**
 * Composed sessions hook using TanStack Query
 * Provides caching, stale-while-revalidate, and background refetches
 */

import { useState, useCallback, useEffect } from 'react'
import { useProjects } from './useProjects'
import { useSessionsList } from './useSessionsList'
import { useSessionMessages } from './useSessionMessages'
import { useSessionMetadata } from './useSessionMetadata'
import { useSendMessage } from './useSendMessage'
import { useCreateSession } from './useCreateSession'
import { useSessionWebSocket, type PendingPermission } from './useSessionWebSocket'
import type { SessionSettings } from '../components/InputBar'
import type { ImageBlock } from '@sidecar/shared'

export function useSessions(
  apiUrl: string,
  settings?: SessionSettings,
  onModelChange?: (model: 'default' | 'sonnet' | 'opus') => void
) {
  // Local UI state (not cacheable)
  const [currentProject, setCurrentProject] = useState<string | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)

  // React Query hooks
  const {
    data: projects = [],
    isLoading: projectsLoading
  } = useProjects(apiUrl)

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    isFetching: sessionsRefreshing,
    refresh: refreshSessions
  } = useSessionsList(apiUrl, currentProject)

  const {
    messages,
    isActive,
    isLoading: messagesLoading,
  } = useSessionMessages(apiUrl, currentSessionId)

  // Fetch metadata (triggers onModelChange side effect)
  useSessionMetadata(apiUrl, currentSessionId, onModelChange)

  // Mutations
  const sendMessageMutation = useSendMessage(apiUrl, currentSessionId, settings)
  const createSessionMutation = useCreateSession(apiUrl, currentProject, settings)

  // WebSocket integration
  const { sendPermissionResponse, sendAbortRequest } = useSessionWebSocket({
    apiUrl,
    currentSessionId,
    onPermissionRequest: (permission) => {
      if (permission.sessionId === currentSessionId) {
        setPendingPermission(permission)
      }
    },
    onPermissionResolved: (toolId) => {
      setPendingPermission(prev => {
        if (prev && (prev.toolUseId === toolId || prev.requestId === toolId)) {
          return null
        }
        return prev
      })
    },
    onSessionAborted: () => {
      setIsProcessing(false)
      setPendingPermission(null)
    },
    onProcessingComplete: () => {
      setIsProcessing(false)
    },
    onToolResolved: (toolUseId) => {
      // Clear pending permission if the tool was resolved elsewhere
      setPendingPermission(prev => {
        if (prev && prev.toolUseId === toolUseId) {
          return null
        }
        return prev
      })
    },
  })

  // Auto-select first project when projects load
  useEffect(() => {
    if (projects.length > 0 && !currentProject) {
      setCurrentProject(projects[0].path)
    }
  }, [projects, currentProject])

  // Set isProcessing when selecting an active session
  useEffect(() => {
    if (isActive) {
      setIsProcessing(true)
    }
  }, [isActive])

  // Actions
  const selectProject = useCallback((projectPath: string) => {
    setCurrentProject(projectPath)
    setCurrentSessionId(null)
  }, [])

  const selectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId)
    setPendingPermission(null)
    setIsProcessing(false)
  }, [])

  const sendMessage = useCallback(async (text: string, images?: ImageBlock[]) => {
    if (!currentSessionId || sendMessageMutation.isPending) return

    setIsProcessing(true)
    sendMessageMutation.mutate({ text, images })
  }, [currentSessionId, sendMessageMutation])

  const createSession = useCallback(async (text: string, images?: ImageBlock[]): Promise<string | null> => {
    if (!currentProject || createSessionMutation.isPending) return null

    setIsProcessing(true)

    try {
      const result = await createSessionMutation.mutateAsync({ text, images })
      return result.sessionId
    } catch (e) {
      console.error('Failed to create session:', e)
      setIsProcessing(false)
      return null
    }
  }, [currentProject, createSessionMutation])

  const respondToPermission = useCallback((
    allow: boolean,
    options?: { answers?: Record<string, string[]>; allowAll?: boolean }
  ) => {
    if (!pendingPermission) return

    sendPermissionResponse(pendingPermission, allow, options)
    setPendingPermission(null)
  }, [pendingPermission, sendPermissionResponse])

  const abortSession = useCallback(() => {
    if (!currentSessionId) return

    sendAbortRequest(currentSessionId)
    setIsProcessing(false)
  }, [currentSessionId, sendAbortRequest])

  const clearForNewSession = useCallback(() => {
    setCurrentSessionId(null)
  }, [])

  return {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    messages,
    loading: projectsLoading || sessionsLoading || messagesLoading,
    sending: sendMessageMutation.isPending,
    isProcessing,
    pendingPermission,
    sendMessage,
    createSession,
    selectProject,
    selectSession,
    respondToPermission,
    abortSession,
    clearForNewSession,
    refresh: refreshSessions,
    isRefreshing: sessionsRefreshing,
  }
}
