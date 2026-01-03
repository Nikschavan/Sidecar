import { useState, useEffect } from 'react'
import { useSessions } from './hooks/useSessions'
import { HomeScreen } from './screens/HomeScreen'
import { ChatScreen } from './screens/ChatScreen'
import { NewSessionScreen } from './screens/NewSessionScreen'
import { AuthGate } from './components/AuthGate'
import type { SessionSettings } from './components/InputBar'
import type { ImageBlock } from '@sidecar/shared'

// Get API URL from current location or default to localhost
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3456'
  : `http://${window.location.hostname}:3456`

// Simple hash-based router
function useRouter() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseHash(window.location.hash))
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  return route
}

function parseHash(hash: string): { screen: 'home' | 'chat' | 'new'; sessionId?: string } {
  if (hash === '#/new') {
    return { screen: 'new' }
  }
  if (hash.startsWith('#/session/')) {
    const sessionId = hash.slice('#/session/'.length)
    return { screen: 'chat', sessionId }
  }
  return { screen: 'home' }
}

function navigate(path: string) {
  window.location.hash = path
}

const DEFAULT_SETTINGS: SessionSettings = {
  permissionMode: 'default',
  model: 'default'
}

const SETTINGS_STORAGE_KEY = 'sidecar-permission-mode'

function loadSettings(): SessionSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (stored) {
      // Only load permissionMode from storage, model comes from session
      return { ...DEFAULT_SETTINGS, permissionMode: stored as SessionSettings['permissionMode'] }
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  return DEFAULT_SETTINGS
}

function savePermissionMode(mode: SessionSettings['permissionMode']) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, mode)
  } catch (e) {
    console.error('Failed to save permission mode:', e)
  }
}

function AppContent() {
  const route = useRouter()
  const [settings, setSettings] = useState<SessionSettings>(loadSettings)

  // Handle settings change - persist only permissionMode
  const handleSettingsChange = (newSettings: SessionSettings) => {
    setSettings(newSettings)
    // Only persist permissionMode to localStorage
    if (newSettings.permissionMode !== settings.permissionMode) {
      savePermissionMode(newSettings.permissionMode)
    }
  }

  // Handle model change from session metadata
  const handleModelChange = (model: 'default' | 'sonnet' | 'opus') => {
    setSettings(prev => ({ ...prev, model }))
  }

  const {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    messages,
    loading,
    sending,
    isProcessing,
    pendingPermission,
    sendMessage,
    createSession,
    selectProject,
    selectSession,
    respondToPermission,
    abortSession,
    clearForNewSession,
    refresh,
    isRefreshing
  } = useSessions(API_URL, settings, handleModelChange)

  // Sync URL session with state
  useEffect(() => {
    if (route.screen === 'chat' && route.sessionId && route.sessionId !== currentSessionId) {
      selectSession(route.sessionId)
    }
  }, [route, currentSessionId, selectSession])

  const handleSelectSession = (sessionId: string) => {
    selectSession(sessionId)
    navigate(`/session/${sessionId}`)
  }

  const handleBack = () => {
    navigate('/')
  }

  const handleNewSession = () => {
    clearForNewSession()
    navigate('/new')
  }

  const handleCreateSession = async (text: string, images?: ImageBlock[]): Promise<string | null> => {
    console.log('[App] handleCreateSession called with:', text.slice(0, 30), images?.length ?? 0, 'images')
    const sessionId = await createSession(text, images)
    console.log('[App] createSession returned:', sessionId)
    if (sessionId) {
      console.log('[App] Navigating to session:', sessionId)
      navigate(`/session/${sessionId}`)
      return sessionId
    } else {
      console.error('[App] No sessionId returned')
      return null
    }
  }

  if (route.screen === 'new') {
    return (
      <NewSessionScreen
        projects={projects}
        currentProject={currentProject}
        settings={settings}
        onProjectChange={selectProject}
        onCreateSession={handleCreateSession}
        onSettingsChange={handleSettingsChange}
        onBack={handleBack}
      />
    )
  }

  if (route.screen === 'chat' && route.sessionId) {
    const currentSession = sessions.find(s => s.id === route.sessionId)
    return (
      <ChatScreen
        sessionId={route.sessionId}
        sessionName={currentSession?.name ?? null}
        messages={messages}
        loading={loading}
        sending={sending}
        isProcessing={isProcessing}
        pendingPermission={pendingPermission}
        settings={settings}
        onSend={sendMessage}
        onBack={handleBack}
        onPermissionResponse={respondToPermission}
        onSettingsChange={handleSettingsChange}
        onAbort={abortSession}
      />
    )
  }

  return (
    <HomeScreen
      projects={projects}
      currentProject={currentProject}
      sessions={sessions}
      onProjectChange={selectProject}
      onSelectSession={handleSelectSession}
      onNewSession={handleNewSession}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
    />
  )
}

function App() {
  return (
    <AuthGate apiUrl={API_URL}>
      <AppContent />
    </AuthGate>
  )
}

export default App
