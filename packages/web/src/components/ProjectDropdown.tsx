import { useState, useRef, useEffect } from 'react'

interface Project {
  path: string
  name: string
  modifiedAt: string
}

interface ProjectDropdownProps {
  projects: Project[]
  currentProject: string | null
  onProjectChange: (path: string) => void
  className?: string
}

export function ProjectDropdown({ projects, currentProject, onProjectChange, className = '' }: ProjectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedProject = projects.find(p => p.path === currentProject)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (path: string) => {
    onProjectChange(path)
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-claude-bg-light text-left rounded-lg px-4 py-3 border border-claude-border focus:outline-none focus:border-claude-accent transition-colors"
      >
        {selectedProject ? (
          <div className="min-w-0">
            <div className="text-sm font-medium text-claude-text truncate">
              {selectedProject.name}
            </div>
            <div className="text-xs text-claude-text-muted truncate">
              {selectedProject.path}
            </div>
          </div>
        ) : (
          <div className="text-sm text-claude-text-muted">Select a project...</div>
        )}
        <svg
          className={`absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-claude-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-claude-bg-light border border-claude-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {projects.length === 0 ? (
            <div className="px-4 py-3 text-sm text-claude-text-muted">No projects available</div>
          ) : (
            projects.map((project) => (
              <button
                key={project.path}
                onClick={() => handleSelect(project.path)}
                className={`w-full text-left px-4 py-3 hover:bg-claude-bg transition-colors first:rounded-t-lg last:rounded-b-lg ${
                  project.path === currentProject ? 'bg-claude-bg' : ''
                }`}
              >
                <div className="text-sm font-medium text-claude-text truncate">
                  {project.name}
                </div>
                <div className="text-xs text-claude-text-muted truncate">
                  {project.path}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
