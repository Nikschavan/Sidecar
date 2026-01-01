import { useState } from 'react'
import { useSessions } from './hooks/useSessions'
import { Header } from './components/Header'
import { ChatView } from './components/ChatView'
import { InputBar } from './components/InputBar'
import { SessionList } from './components/SessionList'

// Get API URL from current location or default to localhost
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3456'
  : `http://${window.location.hostname}:3456`

function App() {
  const [showSessions, setShowSessions] = useState(false)

  const {
    projects,
    currentProject,
    sessions,
    currentSessionId,
    messages,
    loading,
    sending,
    sendMessage,
    selectProject,
    selectSession
  } = useSessions(API_URL)

  // Simple connection status based on session data
  const status = currentSessionId ? 'connected' : 'connecting'

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <Header
        projects={projects}
        currentProject={currentProject}
        sessionId={currentSessionId}
        status={status}
        onProjectChange={selectProject}
        onSessionsClick={() => setShowSessions(true)}
      />

      <ChatView
        messages={messages}
        loading={loading}
        sending={sending}
      />

      <InputBar
        onSend={sendMessage}
        disabled={sending || !currentSessionId}
        placeholder={currentSessionId ? 'Message Claude...' : 'Select a session'}
      />

      {showSessions && (
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={selectSession}
          onClose={() => setShowSessions(false)}
        />
      )}
    </div>
  )
}

export default App
