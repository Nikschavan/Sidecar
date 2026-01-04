/**
 * Composed sessions hook using TanStack Query
 * Provides caching, stale-while-revalidate, and background refetches
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useProjects } from './useProjects'
import { useSessionsList } from './useSessionsList'
import { useSessionMessages } from './useSessionMessages'
import { useSessionMetadata } from './useSessionMetadata'
import { useSendMessage } from './useSendMessage'
import { useCreateSession } from './useCreateSession'
import { useSessionSSE, type PendingPermission } from './useSessionSSE'
import type { SessionSettings } from '../components/InputBar'
import type { ImageBlock, ChatMessage } from '@sidecar/shared'

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
  // Temporary session name for newly created sessions (before sessions list refreshes)
  const [pendingSessionName, setPendingSessionName] = useState<string | null>(null)
  // Pending initial message shown optimistically until real messages load
  const [pendingInitialMessage, setPendingInitialMessage] = useState<{ text: string; images?: ImageBlock[] } | null>(null)

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
    messages: fetchedMessages,
    isActive,
    isLoading: messagesLoading,
  } = useSessionMessages(apiUrl, currentSessionId)

  // Clear pending initial message once real messages are loaded
  useEffect(() => {
    if (fetchedMessages.length > 0 && pendingInitialMessage) {
      setPendingInitialMessage(null)
    }
  }, [fetchedMessages.length, pendingInitialMessage])

  // Combine pending initial message with fetched messages
  const messages = useMemo((): ChatMessage[] => {
    // If we have real messages, use those
    if (fetchedMessages.length > 0) {
      return fetchedMessages
    }
    // If we have a pending initial message, show it optimistically
    if (pendingInitialMessage) {
      // Build content array - ContentBlock is string | ImageBlock
      const content: (string | ImageBlock)[] = [pendingInitialMessage.text]
      if (pendingInitialMessage.images?.length) {
        content.push(...pendingInitialMessage.images)
      }
      const optimisticMessage: ChatMessage = {
        id: 'pending-initial-message',
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      }
      return [optimisticMessage]
    }
    return []
  }, [fetchedMessages, pendingInitialMessage])

  // Fetch metadata (triggers onModelChange side effect)
  useSessionMetadata(apiUrl, currentSessionId, onModelChange)

  // Mutations
  const sendMessageMutation = useSendMessage(apiUrl, currentSessionId, settings)
  const createSessionMutation = useCreateSession(apiUrl, currentProject, settings)

  // SSE integration (replaced WebSocket)
  const { sendPermissionResponse, sendAbortRequest } = useSessionSSE({
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
    setPendingInitialMessage(null)
    setPendingSessionName(null)
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
      // Set the current session ID immediately so messages start loading
      setCurrentSessionId(result.sessionId)
      // Store the initial message text as a temporary session name
      setPendingSessionName(text.slice(0, 100))
      // Store the pending message to show optimistically
      setPendingInitialMessage({ text, images })
      // Refresh sessions list so new session appears when going back
      refreshSessions()
      return result.sessionId
    } catch (e) {
      console.error('Failed to create session:', e)
      setIsProcessing(false)
      return null
    }
  }, [currentProject, createSessionMutation, refreshSessions])

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
    setPendingSessionName(null)
    setPendingInitialMessage(null)
  }, [])

  return {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    pendingSessionName,
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
