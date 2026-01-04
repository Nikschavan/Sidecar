import { useState, useRef, useEffect } from 'react'

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
  const [isProjectOpen, setIsProjectOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selectedProject = projects.find(p => p.path === currentProject)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProjectOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  const statusColor = {
    connecting: 'bg-yellow-500',
    connected: 'bg-green-500',
    disconnected: 'bg-slate-500',
    error: 'bg-red-500'
  }[status]

  return (
    <header
      className="fixed bg-slate-800/80 backdrop-blur-sm border-b border-slate-700"
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
        <div ref={dropdownRef} className="relative flex-1 min-w-0">
          <button
            onClick={() => setIsProjectOpen(!isProjectOpen)}
            className="w-full bg-slate-700 text-left rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 transition-colors"
          >
            {selectedProject ? (
              <div className="min-w-0 pr-6">
                <div className="text-sm font-medium text-slate-200 truncate">
                  {selectedProject.name}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {selectedProject.path}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-400 pr-6">Select project...</div>
            )}
            <svg
              className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-transform ${isProjectOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isProjectOpen && (
            <div className="absolute z-50 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {projects.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-400">No projects available</div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.path}
                    onClick={() => {
                      onProjectChange(project.path)
                      setIsProjectOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-600 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                      project.path === currentProject ? 'bg-slate-600' : ''
                    }`}
                  >
                    <div className="text-sm font-medium text-slate-200 truncate">
                      {project.name}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {project.path}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

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
