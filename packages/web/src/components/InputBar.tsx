import { useState, useRef, useEffect } from 'react'

export interface SlashCommand {
  command: string
  description: string
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
export type Model = 'default' | 'sonnet' | 'opus'

export interface SessionSettings {
  permissionMode: PermissionMode
  model: Model
}

interface InputBarProps {
  onSend: (text: string) => void
  onAbort?: () => void
  disabled?: boolean
  placeholder?: string
  isProcessing?: boolean
  slashCommands?: SlashCommand[]
  settings?: SessionSettings
  onSettingsChange?: (settings: SessionSettings) => void
}

// Default slash commands (fallback if not provided)
const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { command: '/help', description: 'Show help and available commands' },
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation to save context' },
  { command: '/config', description: 'Open configuration' },
  { command: '/cost', description: 'Show token usage and cost' },
  { command: '/doctor', description: 'Check Claude Code health' },
  { command: '/init', description: 'Initialize project with CLAUDE.md' },
  { command: '/memory', description: 'Edit CLAUDE.md memory file' },
  { command: '/model', description: 'Select AI model' },
  { command: '/review', description: 'Review code changes' },
  { command: '/status', description: 'Show session status' },
  { command: '/vim', description: 'Toggle vim mode' },
]

const DEFAULT_SETTINGS: SessionSettings = {
  permissionMode: 'default',
  model: 'default'
}

type SettingsPanel = 'none' | 'permission' | 'model'

export function InputBar({
  onSend,
  onAbort,
  disabled,
  placeholder = 'Type a message...',
  isProcessing = false,
  slashCommands = DEFAULT_SLASH_COMMANDS,
  settings = DEFAULT_SETTINGS,
  onSettingsChange
}: InputBarProps) {
  const [text, setText] = useState('')
  const [activePanel, setActivePanel] = useState<SettingsPanel>('none')
  const [showSlashCommands, setShowSlashCommands] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const badgesRef = useRef<HTMLDivElement>(null)

  const handlePermissionModeChange = (mode: PermissionMode) => {
    onSettingsChange?.({ ...settings, permissionMode: mode })
    setActivePanel('none')
  }

  const handleModelChange = (model: Model) => {
    onSettingsChange?.({ ...settings, model })
    setActivePanel('none')
  }

  const getPermissionLabel = (mode: PermissionMode) => {
    switch (mode) {
      case 'acceptEdits': return 'Accept Edits'
      case 'plan': return 'Plan Mode'
      case 'bypassPermissions': return 'Yolo'
      default: return 'Default'
    }
  }

  const getModelLabel = (model: Model) => {
    switch (model) {
      case 'sonnet': return 'Sonnet'
      case 'opus': return 'Opus'
      default: return 'Default'
    }
  }

  // Filter commands based on input
  const filteredCommands = text.startsWith('/')
    ? slashCommands.filter(cmd =>
        cmd.command.toLowerCase().includes(text.toLowerCase())
      )
    : []

  // Show/hide slash commands dropdown
  useEffect(() => {
    if (text.startsWith('/') && filteredCommands.length > 0) {
      setShowSlashCommands(true)
      setSelectedCommandIndex(0)
    } else {
      setShowSlashCommands(false)
    }
  }, [text, filteredCommands.length])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }
  }, [text])

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        badgesRef.current &&
        !badgesRef.current.contains(target)
      ) {
        setActivePanel('none')
      }
    }
    if (activePanel !== 'none') {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [activePanel])

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (trimmed && !disabled) {
      onSend(trimmed)
      setText('')
    }
  }

  const selectCommand = (command: string) => {
    setText(command + ' ')
    setShowSlashCommands(false)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle slash command navigation
    if (showSlashCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex(i => (i + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        selectCommand(filteredCommands[selectedCommandIndex].command)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlashCommands(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div
      className="bg-claude-bg px-4 pt-2"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
    >
      {/* Slash commands autocomplete */}
      {showSlashCommands && filteredCommands.length > 0 && (
        <div className="max-w-3xl mx-auto mb-2 bg-claude-bg-light border border-claude-border rounded-xl overflow-hidden">
          {filteredCommands.map((cmd, index) => (
            <button
              key={cmd.command}
              onClick={() => selectCommand(cmd.command)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                index === selectedCommandIndex
                  ? 'bg-claude-surface'
                  : 'hover:bg-claude-bg-lighter'
              }`}
            >
              <span className="text-claude-text font-mono text-sm">{cmd.command}</span>
              <span className="text-claude-text-muted text-sm">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Permission Mode Panel */}
      {activePanel === 'permission' && (
        <div
          ref={panelRef}
          className="max-w-3xl mx-auto mb-3 bg-claude-bg-light border border-claude-border rounded-xl overflow-hidden"
        >
          <div className="p-4">
            <div className="text-sm text-claude-text-muted mb-3">Permission Mode</div>
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
        </div>
      )}

      {/* Model Panel */}
      {activePanel === 'model' && (
        <div
          ref={panelRef}
          className="max-w-3xl mx-auto mb-3 bg-claude-bg-light border border-claude-border rounded-xl overflow-hidden"
        >
          <div className="p-4">
            <div className="text-sm text-claude-text-muted mb-3">Model</div>
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
        </div>
      )}

      {/* Clickable settings badges */}
      <div ref={badgesRef} className="max-w-3xl mx-auto mb-2 flex items-center gap-2 px-1">
        <button
          onClick={() => setActivePanel(activePanel === 'permission' ? 'none' : 'permission')}
          className={`text-xs px-2 py-1 rounded-full transition-colors ${
            activePanel === 'permission'
              ? 'bg-blue-600 text-white'
              : settings.permissionMode !== 'default'
                ? 'bg-claude-surface text-claude-text hover:bg-claude-bg-lighter'
                : 'bg-claude-bg-light text-claude-text-muted hover:bg-claude-surface'
          }`}
        >
          Permission: {getPermissionLabel(settings.permissionMode)}
        </button>
        <button
          onClick={() => setActivePanel(activePanel === 'model' ? 'none' : 'model')}
          className={`text-xs px-2 py-1 rounded-full transition-colors ${
            activePanel === 'model'
              ? 'bg-blue-600 text-white'
              : settings.model !== 'default'
                ? 'bg-claude-surface text-claude-text hover:bg-claude-bg-lighter'
                : 'bg-claude-bg-light text-claude-text-muted hover:bg-claude-surface'
          }`}
        >
          Model: {getModelLabel(settings.model)}
        </button>
      </div>

      {/* Input area */}
      <div className="max-w-3xl mx-auto">
        <div className="bg-claude-surface rounded-2xl px-4 py-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full bg-transparent text-[15px] text-claude-text resize-none focus:outline-none placeholder-claude-text-muted disabled:opacity-50"
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1">
              {/* Abort button - only show when processing */}
              {isProcessing && onAbort && (
                <button
                  onClick={onAbort}
                  className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-claude-bg-lighter text-claude-text-muted hover:text-red-400 transition-colors"
                  title="Abort"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                  </svg>
                </button>
              )}
            </div>

            {/* Send button */}
            <button
              onClick={handleSubmit}
              disabled={disabled || !text.trim()}
              className="w-10 h-10 flex items-center justify-center bg-claude-text-muted rounded-full hover:bg-claude-text disabled:opacity-40 disabled:hover:bg-claude-text-muted transition-colors shrink-0"
            >
              <svg className="w-5 h-5 text-claude-bg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
