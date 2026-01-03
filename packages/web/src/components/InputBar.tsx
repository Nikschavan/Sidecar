import { useState, useRef, useEffect } from 'react'
import type { ImageBlock } from '@sidecar/shared'
import { useImagePicker } from '../hooks/useImagePicker'

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
  onSend: (text: string, images?: ImageBlock[]) => void
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Use custom image picker hook
  const {
    images,
    removeImage,
    clearImages,
    getImageBlocks,
    processFiles,
    hasImages
  } = useImagePicker()

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
    const hasContent = trimmed || hasImages
    if (hasContent && !disabled) {
      const imageBlocks = hasImages ? getImageBlocks() : undefined
      onSend(trimmed, imageBlocks)
      setText('')
      clearImages()
    }
  }

  const selectCommand = (command: string) => {
    setText(command + ' ')
    setShowSlashCommands(false)
    textareaRef.current?.focus()
  }

  // iOS Safari fix: Use native addEventListener instead of React's onChange
  // React's synthetic events don't fire reliably for file inputs on iOS Safari
  useEffect(() => {
    const fileInput = fileInputRef.current

    const handleChange = (e: Event) => {
      console.log('[InputBar] Native change event fired')
      const target = e.target as HTMLInputElement
      const files = target.files
      console.log('[InputBar] Files from native event:', files?.length)

      // Capture files before reset
      const filesToProcess = files ? Array.from(files) : []
      target.value = ''

      if (filesToProcess.length > 0) {
        processFiles(filesToProcess)
      }
    }

    // Attach native listener
    fileInput?.addEventListener('change', handleChange)

    return () => {
      fileInput?.removeEventListener('change', handleChange)
    }
  }, [processFiles])

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
          {/* Attached images preview */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {images.map((img) => (
                <div key={img.id} className="relative group">
                  <img
                    src={img.preview}
                    alt="Attached"
                    className="w-16 h-16 object-cover rounded-lg border border-claude-border"
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

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

          {/* Hidden file input - using opacity:0 instead of display:none for iOS Safari compatibility */}
          {/* Note: onChange handled via native addEventListener in useEffect for iOS Safari */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif"
            style={{
              position: 'absolute',
              opacity: 0,
              width: 0,
              height: 0,
              pointerEvents: 'none'
            }}
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1">
              {/* Image upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-claude-bg-lighter text-claude-text-muted hover:text-claude-text transition-colors cursor-pointer"
                title="Attach image"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            </div>

            {/* Abort button - show when processing, replaces send button */}
            {isProcessing && onAbort ? (
              <button
                onClick={onAbort}
                className="w-10 h-10 flex items-center justify-center bg-claude-btn-stop hover:bg-claude-bg-lighter rounded-full transition-colors shrink-0"
                title="Stop (Ctrl+C)"
              >
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              /* Send button - orange disabled, coral active */
              <button
                onClick={handleSubmit}
                disabled={disabled || (!text.trim() && !hasImages)}
                className="w-10 h-10 flex items-center justify-center rounded-full transition-colors shrink-0 bg-claude-btn-active hover:bg-claude-accent-hover disabled:bg-claude-btn-disabled disabled:hover:bg-claude-btn-disabled"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
