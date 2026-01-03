import { useState, useRef, useEffect } from 'react'
import type { ImageBlock } from '@sidecar/shared'
import { InputBar, type SessionSettings, type PermissionMode, type Model } from '../components/InputBar'
import { ProjectDropdown } from '../components/ProjectDropdown'

interface Project {
  path: string
  name: string
  modifiedAt: string
}

interface NewSessionScreenProps {
  projects: Project[]
  currentProject: string | null
  settings: SessionSettings
  onProjectChange: (path: string) => void
  onCreateSession: (text: string, images?: ImageBlock[]) => Promise<string | null>
  onSettingsChange: (settings: SessionSettings) => void
  onBack: () => void
}

export function NewSessionScreen({
  projects,
  currentProject,
  settings,
  onProjectChange,
  onCreateSession,
  onSettingsChange,
  onBack
}: NewSessionScreenProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<{ text: string; images?: ImageBlock[] } | null>(null)
  const [useCustomPath, setUseCustomPath] = useState(false)
  const [customPath, setCustomPath] = useState('')
  const customPathInputRef = useRef<HTMLInputElement>(null)

  // Focus custom path input when toggled
  useEffect(() => {
    if (useCustomPath && customPathInputRef.current) {
      customPathInputRef.current.focus()
    }
  }, [useCustomPath])

  const handleSubmit = async (text: string, images?: ImageBlock[]) => {
    if (isCreating) return

    setIsCreating(true)
    setPendingMessage({ text, images })

    // If using custom path, update the project first
    if (useCustomPath && customPath.trim()) {
      onProjectChange(customPath.trim())
    }

    try {
      const sessionId = await onCreateSession(text, images)
      if (!sessionId) {
        // Creation failed
        setIsCreating(false)
        setPendingMessage(null)
      }
      // If successful, navigation happens in parent - we don't need to reset state
    } catch (e) {
      console.error('Failed to create session:', e)
      setIsCreating(false)
      setPendingMessage(null)
    }
  }

  const handlePermissionModeChange = (mode: PermissionMode) => {
    onSettingsChange({ ...settings, permissionMode: mode })
  }

  const handleModelChange = (model: Model) => {
    onSettingsChange({ ...settings, model })
  }

  return (
    <div className="h-full flex flex-col bg-claude-bg overflow-x-hidden">
      {/* Header */}
      <header
        className="px-4 flex items-center gap-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}
      >
        <button
          onClick={onBack}
          className="p-2 -ml-2 hover:bg-claude-bg-light rounded-full transition-colors shrink-0"
        >
          <svg className="w-6 h-6 text-claude-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        <h1 className="text-base font-medium text-claude-text">
          New Session
        </h1>
      </header>

      {/* Settings Form */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Project Selection */}
          <div className="bg-claude-bg-light rounded-xl p-4">
            <label className="text-sm text-claude-text-muted mb-3 block">Project</label>

            {!useCustomPath ? (
              <ProjectDropdown
                projects={projects}
                currentProject={currentProject}
                onProjectChange={onProjectChange}
              />
            ) : (
              <input
                ref={customPathInputRef}
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/path/to/project"
                className="w-full px-4 py-3 bg-claude-surface border border-claude-border rounded-lg text-claude-text placeholder-claude-text-muted focus:outline-none focus:border-claude-accent"
              />
            )}

            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useCustomPath}
                onChange={(e) => setUseCustomPath(e.target.checked)}
                className="w-4 h-4 rounded border-claude-border text-claude-accent focus:ring-claude-accent"
              />
              <span className="text-sm text-claude-text-muted">Use custom path</span>
            </label>
          </div>

          {/* Model Selection */}
          <div className="bg-claude-bg-light rounded-xl p-4">
            <label className="text-sm text-claude-text-muted mb-3 block">Model</label>
            <div className="space-y-2">
              {[
                { value: 'default', label: 'Default', description: 'Use configured default' },
                { value: 'sonnet', label: 'Sonnet', description: 'Fast and capable' },
                { value: 'opus', label: 'Opus', description: 'Most capable' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleModelChange(option.value as Model)}
                  className="flex items-center gap-3 w-full text-left py-2 hover:bg-claude-bg-lighter rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    settings.model === option.value
                      ? 'border-claude-text'
                      : 'border-claude-text-muted'
                  }`}>
                    {settings.model === option.value && (
                      <span className="w-2.5 h-2.5 rounded-full bg-claude-text" />
                    )}
                  </span>
                  <div className="flex-1">
                    <span className="text-claude-text">{option.label}</span>
                    <span className="text-claude-text-muted text-xs ml-2">{option.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Permission Mode Selection */}
          <div className="bg-claude-bg-light rounded-xl p-4">
            <label className="text-sm text-claude-text-muted mb-3 block">Permission Mode</label>
            <div className="space-y-2">
              {[
                { value: 'default', label: 'Default', description: 'Ask for permission on each action' },
                { value: 'acceptEdits', label: 'Accept Edits', description: 'Auto-accept file edits' },
                { value: 'plan', label: 'Plan Mode', description: 'Review and approve plans first' },
                { value: 'bypassPermissions', label: 'Yolo', description: 'Skip all permission checks' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => handlePermissionModeChange(option.value as PermissionMode)}
                  className="flex items-center gap-3 w-full text-left py-2 hover:bg-claude-bg-lighter rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    settings.permissionMode === option.value
                      ? 'border-claude-text'
                      : 'border-claude-text-muted'
                  }`}>
                    {settings.permissionMode === option.value && (
                      <span className="w-2.5 h-2.5 rounded-full bg-claude-text" />
                    )}
                  </span>
                  <div className="flex-1">
                    <span className="text-claude-text">{option.label}</span>
                    <span className="text-claude-text-muted text-xs ml-2">{option.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Creating indicator with pending message */}
          {isCreating && pendingMessage && (
            <div className="bg-claude-bg-light rounded-xl p-4">
              {/* Pending message preview */}
              <div className="mb-4 bg-claude-surface rounded-xl p-4 max-w-[85%] ml-auto">
                <p className="text-claude-text whitespace-pre-wrap">{pendingMessage.text}</p>
                {pendingMessage.images && pendingMessage.images.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {pendingMessage.images.map((img, i) => (
                      <img
                        key={i}
                        src={`data:${img.source.media_type};base64,${img.source.data}`}
                        alt="Attached"
                        className="w-16 h-16 object-cover rounded-lg border border-claude-border"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Loading indicator */}
              <div className="flex items-center justify-center gap-2 text-claude-text-muted">
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Creating session...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <InputBar
        onSend={handleSubmit}
        disabled={isCreating}
        placeholder="Type your first message..."
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
    </div>
  )
}
