interface Project {
  path: string
  name: string
  modifiedAt: string
}

interface HeaderProps {
  projects: Project[]
  currentProject: string | null
  sessionId: string | null
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  onProjectChange: (path: string) => void
  onSessionsClick: () => void
}

export function Header({ projects, currentProject, sessionId, status, onProjectChange, onSessionsClick }: HeaderProps) {
  const statusColor = {
    connecting: 'bg-yellow-500',
    connected: 'bg-green-500',
    disconnected: 'bg-slate-500',
    error: 'bg-red-500'
  }[status]

  return (
    <header
      className="bg-slate-800/80 backdrop-blur-sm border-b border-slate-700"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}
    >
      {/* Top row: Logo and status */}
      <div className="flex items-center justify-between px-4 mb-2">
        <div className="flex items-center gap-2">
          <div className="text-lg font-bold text-primary-400">⚡ Sidecar</div>
          <div className={`w-2 h-2 rounded-full ${statusColor}`} title={status} />
        </div>
      </div>

      {/* Bottom row: Project dropdown and session selector */}
      <div className="flex items-center gap-2 px-4">
        {/* Project dropdown */}
        <select
          value={currentProject || ''}
          onChange={(e) => onProjectChange(e.target.value)}
          className="flex-1 bg-slate-700 text-sm rounded-lg px-3 py-2 text-slate-200 border-none focus:ring-2 focus:ring-primary-500 truncate"
        >
          <option value="" disabled>Select project...</option>
          {(projects || []).map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Session button */}
        <button
          onClick={onSessionsClick}
          className="flex items-center gap-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors shrink-0"
        >
          <span className="font-mono text-slate-300">
            {sessionId ? sessionId.slice(0, 6) : '---'}
          </span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </header>
  )
}
