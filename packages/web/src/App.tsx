import { useState, useEffect } from 'react'
import { useSessions } from './hooks/useSessions'
import { HomeScreen } from './screens/HomeScreen'
import { ChatScreen } from './screens/ChatScreen'

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

function App() {
  const route = useRouter()

  const {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    messages,
    loading,
    sending,
    pendingPermission,
    slashCommands,
    sendMessage,
    createSession,
    selectProject,
    selectSession,
    respondToPermission,
    clearForNewSession
  } = useSessions(API_URL)

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

  const handleCreateSession = async (text: string) => {
    console.log('[App] handleCreateSession called with:', text.slice(0, 30))
    const sessionId = await createSession(text)
    console.log('[App] createSession returned:', sessionId)
    if (sessionId) {
      console.log('[App] Navigating to session:', sessionId)
      navigate(`/session/${sessionId}`)
    } else {
      console.error('[App] No sessionId returned')
    }
  }

  if (route.screen === 'new') {
    return (
      <ChatScreen
        sessionId="new"
        sessionName="New Session"
        messages={messages}
        loading={false}
        sending={sending}
        pendingPermission={null}
        slashCommands={slashCommands}
        onSend={handleCreateSession}
        onBack={handleBack}
        onPermissionResponse={respondToPermission}
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
        pendingPermission={pendingPermission}
        slashCommands={slashCommands}
        onSend={sendMessage}
        onBack={handleBack}
        onPermissionResponse={respondToPermission}
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
    />
  )
}

export default App
