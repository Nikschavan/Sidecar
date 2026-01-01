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

function parseHash(hash: string): { screen: 'home' | 'chat'; sessionId?: string } {
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
    sendMessage,
    selectProject,
    selectSession,
    respondToPermission
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

  if (route.screen === 'chat' && route.sessionId) {
    return (
      <ChatScreen
        sessionId={route.sessionId}
        messages={messages}
        loading={loading}
        sending={sending}
        pendingPermission={pendingPermission}
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
    />
  )
}

export default App
