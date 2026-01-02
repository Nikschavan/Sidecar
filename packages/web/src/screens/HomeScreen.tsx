import { ProjectDropdown } from '../components/ProjectDropdown'

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
  onNewSession: () => void
}

export function HomeScreen({
  projects,
  currentProject,
  sessions,
  onProjectChange,
  onSelectSession,
  onNewSession
}: HomeScreenProps) {
  const currentProjectName = projects.find(p => p.path === currentProject)?.name || 'Select project'

  return (
    <div className="h-full flex flex-col bg-claude-bg overflow-x-hidden">
      {/* Header */}
      <header
        className="px-4 flex items-center justify-between"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: '12px' }}
      >
        {/* Project selector button */}
        <button className="p-2 -ml-2 hover:bg-claude-bg-light rounded-full transition-colors">
          <svg className="w-6 h-6 text-claude-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        <h1 className="text-lg font-medium text-claude-text">Code</h1>

        <div className="w-10" /> {/* Spacer for centering */}
      </header>

      {/* Project dropdown */}
      <div className="px-4 pb-4">
        <ProjectDropdown
          projects={projects}
          currentProject={currentProject}
          onProjectChange={onProjectChange}
        />
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4">
        {!currentProject ? (
          <div className="flex items-center justify-center h-full text-claude-text-muted">
            Select a project to view sessions
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-claude-text-muted">
            No sessions in this project
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className="w-full text-left py-4 flex items-center justify-between group hover:bg-claude-bg-light rounded-lg px-2 -mx-2 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] text-claude-text truncate">
                    {session.name || 'Untitled session'}
                  </div>
                  <div className="text-sm text-claude-text-muted truncate">
                    {currentProjectName}
                  </div>
                </div>
                <svg className="w-5 h-5 text-claude-text-dim shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* New session button */}
      <div
        className="px-4 pt-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        <button
          onClick={onNewSession}
          disabled={!currentProject}
          className="w-full bg-[#f5f3ef] text-[#2a2624] py-3.5 rounded-full text-[15px] font-medium hover:bg-[#ebe8e4] disabled:opacity-50 disabled:hover:bg-[#f5f3ef] transition-colors"
        >
          New session
        </button>
      </div>
    </div>
  )
}
