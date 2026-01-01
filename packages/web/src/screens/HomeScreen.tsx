import { formatDistanceToNow } from '../utils/time'

interface Project {
  path: string
  name: string
  modifiedAt: string
}

interface Session {
  id: string
  name: string | null
  modifiedAt: string
  size: number
}

interface HomeScreenProps {
  projects: Project[]
  currentProject: string | null
  sessions: Session[]
  onProjectChange: (path: string) => void
  onSelectSession: (id: string) => void
}

export function HomeScreen({
  projects,
  currentProject,
  sessions,
  onProjectChange,
  onSelectSession
}: HomeScreenProps) {
  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <header
        className="bg-slate-800 border-b border-slate-700 px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: '16px' }}
      >
        <div className="text-xl font-bold text-primary-400 mb-4">Sidecar</div>

        {/* Project selector */}
        <select
          value={currentProject || ''}
          onChange={(e) => onProjectChange(e.target.value)}
          className="w-full bg-slate-700 text-sm rounded-lg px-4 py-3 text-slate-200 border-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="" disabled>Select a project...</option>
          {(projects || []).map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </select>
      </header>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto">
        {!currentProject ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            Select a project to view sessions
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            No sessions in this project
          </div>
        ) : (
          <div className="p-4 space-y-2">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">
              Sessions ({sessions.length})
            </div>
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className="w-full text-left p-4 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
              >
                <div className="text-sm text-slate-200 truncate mb-1">
                  {session.name || 'Untitled session'}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="font-mono">{session.id.slice(0, 8)}</span>
                  <span>{formatDistanceToNow(session.modifiedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
