interface HeaderProps {
  sessionId: string | null
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  onSessionsClick: () => void
}

export function Header({ sessionId, status, onSessionsClick }: HeaderProps) {
  const statusColor = {
    connecting: 'bg-yellow-500',
    connected: 'bg-green-500',
    disconnected: 'bg-slate-500',
    error: 'bg-red-500'
  }[status]

  return (
    <header 
      className="bg-slate-800/80 backdrop-blur-sm border-b border-slate-700 flex items-center justify-between px-4"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}
    >
      <div className="flex items-center gap-3">
        <div className="text-xl font-bold text-primary-400">⚡ Sidecar</div>
        <div className={`w-2 h-2 rounded-full ${statusColor}`} title={status} />
      </div>
      
      <button
        onClick={onSessionsClick}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
      >
        <span className="font-mono text-slate-300">
          {sessionId ? sessionId.slice(0, 8) + '...' : 'No session'}
        </span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </header>
  )
}
