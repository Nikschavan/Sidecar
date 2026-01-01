import { useState, useRef, useEffect } from 'react'

interface InputBarProps {
  onSend: (text: string) => void
  onAbort?: () => void
  disabled?: boolean
  placeholder?: string
  isProcessing?: boolean
}

type PermissionMode = 'default' | 'accept-edits' | 'plan' | 'yolo'
type Model = 'default' | 'sonnet' | 'opus'

export function InputBar({
  onSend,
  onAbort,
  disabled,
  placeholder = 'Type a message...',
  isProcessing = false
}: InputBarProps) {
  const [text, setText] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [model, setModel] = useState<Model>('default')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }
  }, [text])

  // Close settings when clicking outside (but not on the settings button)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        settingsRef.current &&
        !settingsRef.current.contains(target) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(target)
      ) {
        setShowSettings(false)
      }
    }
    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSettings])

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (trimmed && !disabled) {
      onSend(trimmed)
      setText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      {/* Settings dialog */}
      {showSettings && (
        <div
          ref={settingsRef}
          className="max-w-3xl mx-auto mb-3 bg-claude-bg-light border border-claude-border rounded-xl overflow-hidden"
        >
          {/* Permission Mode */}
          <div className="p-4">
            <div className="text-sm text-claude-text-muted mb-3">Permission Mode</div>
            <div className="space-y-2">
              {[
                { value: 'default', label: 'Default' },
                { value: 'accept-edits', label: 'Accept Edits' },
                { value: 'plan', label: 'Plan Mode' },
                { value: 'yolo', label: 'Yolo' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setPermissionMode(option.value as PermissionMode)}
                  className="flex items-center gap-3 w-full text-left py-2 hover:bg-claude-bg-lighter rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    permissionMode === option.value
                      ? 'border-claude-text'
                      : 'border-claude-text-muted'
                  }`}>
                    {permissionMode === option.value && (
                      <span className="w-2.5 h-2.5 rounded-full bg-claude-text" />
                    )}
                  </span>
                  <span className="text-claude-text">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-claude-border" />

          {/* Model */}
          <div className="p-4">
            <div className="text-sm text-claude-text-muted mb-3">Model</div>
            <div className="space-y-2">
              {[
                { value: 'default', label: 'Default' },
                { value: 'sonnet', label: 'Sonnet' },
                { value: 'opus', label: 'Opus' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setModel(option.value as Model)}
                  className="flex items-center gap-3 w-full text-left py-2 hover:bg-claude-bg-lighter rounded-lg px-2 -mx-2 transition-colors"
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    model === option.value
                      ? 'border-claude-text'
                      : 'border-claude-text-muted'
                  }`}>
                    {model === option.value && (
                      <span className="w-2.5 h-2.5 rounded-full bg-claude-text" />
                    )}
                  </span>
                  <span className="text-claude-text">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
              {/* Settings button */}
              <button
                ref={settingsButtonRef}
                onClick={() => setShowSettings(!showSettings)}
                className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
                  showSettings
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-claude-bg-lighter text-claude-text-muted hover:text-claude-text'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

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
