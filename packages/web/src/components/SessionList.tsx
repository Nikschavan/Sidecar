import { formatDistanceToNow } from '../utils/time'

interface Session {
  id: string
  modifiedAt: string
  size: number
}

interface SessionListProps {
  sessions: Session[]
  currentSessionId: string | null
  onSelect: (id: string) => void
  onClose: () => void
}

export function SessionList({ sessions, currentSessionId, onSelect, onClose }: SessionListProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-slate-800 w-full sm:max-w-md sm:rounded-xl max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Sessions</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="overflow-y-auto flex-1 p-2">
          {sessions.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              No sessions found
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  onSelect(session.id)
                  onClose()
                }}
                className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                  session.id === currentSessionId
                    ? 'bg-primary-600/20 border border-primary-500'
                    : 'hover:bg-slate-700'
                }`}
              >
                <div className="font-mono text-sm text-slate-300 truncate">
                  {session.id.slice(0, 8)}...
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {formatDistanceToNow(session.modifiedAt)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
