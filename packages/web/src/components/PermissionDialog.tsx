import { useState } from 'react'

interface PermissionDialogProps {
  toolName: string
  input: Record<string, unknown>
  onRespond: (allow: boolean, options?: { allowAll?: boolean; customMessage?: string }) => void
}

export function PermissionDialog({ toolName, input, onRespond }: PermissionDialogProps) {
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customMessage, setCustomMessage] = useState('')

  // Format the tool-specific display
  const renderToolDetails = () => {
    switch (toolName) {
      case 'Bash': {
        const command = input.command as string
        const description = input.description as string
        return (
          <div className="space-y-2">
            <div className="text-claude-coral font-semibold text-sm">Bash command</div>
            <div className="bg-claude-bg rounded-lg p-3 font-mono text-sm">
              <div className="text-claude-text whitespace-pre-wrap break-all">{command}</div>
              {description && (
                <div className="text-claude-text-muted mt-1 text-xs">{description}</div>
              )}
            </div>
          </div>
        )
      }

      case 'Read': {
        const filePath = input.file_path as string
        return (
          <div className="space-y-2">
            <div className="text-claude-coral font-semibold text-sm">Read file</div>
            <div className="bg-claude-bg rounded-lg p-3 font-mono text-sm text-claude-text break-all">
              {filePath}
            </div>
          </div>
        )
      }

      case 'Edit': {
        const filePath = input.file_path as string
        return (
          <div className="space-y-2">
            <div className="text-claude-coral font-semibold text-sm">Edit file</div>
            <div className="bg-claude-bg rounded-lg p-3 font-mono text-sm text-claude-text break-all">
              {filePath}
            </div>
          </div>
        )
      }

      case 'Write': {
        const filePath = input.file_path as string
        return (
          <div className="space-y-2">
            <div className="text-claude-coral font-semibold text-sm">Write file</div>
            <div className="bg-claude-bg rounded-lg p-3 font-mono text-sm text-claude-text break-all">
              {filePath}
            </div>
          </div>
        )
      }

      case 'Glob':
      case 'Grep': {
        const pattern = (input.pattern as string) || ''
        const path = (input.path as string) || '.'
        return (
          <div className="space-y-2">
            <div className="text-claude-coral font-semibold text-sm">{toolName}</div>
            <div className="bg-claude-bg rounded-lg p-3 font-mono text-sm">
              <div className="text-claude-text">Pattern: {pattern}</div>
              <div className="text-claude-text-muted text-xs mt-1">in {path}</div>
            </div>
          </div>
        )
      }

      default: {
        // Generic fallback - show formatted JSON
        return (
          <div className="space-y-2">
            <div className="text-claude-coral font-semibold text-sm">{toolName}</div>
            <div className="bg-claude-bg rounded-lg p-3 font-mono text-xs text-claude-text-muted overflow-x-auto max-h-32 overflow-y-auto">
              <pre>{JSON.stringify(input, null, 2)}</pre>
            </div>
          </div>
        )
      }
    }
  }

  const handleCustomSubmit = () => {
    if (customMessage.trim()) {
      onRespond(false, { customMessage: customMessage.trim() })
    }
  }

  return (
    <div className="bg-claude-bg-light border-t border-claude-border p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Tool details */}
        {renderToolDetails()}

        {/* Question */}
        <div className="text-claude-text font-medium">Do you want to proceed?</div>

        {/* Options */}
        {!showCustomInput ? (
          <div className="space-y-2">
            <button
              onClick={() => onRespond(true)}
              className="w-full text-left px-4 py-2.5 rounded-lg bg-claude-bg hover:bg-claude-surface transition-colors group"
            >
              <span className="text-claude-text-muted mr-2">1.</span>
              <span className="text-claude-text group-hover:text-white">Yes</span>
            </button>

            <button
              onClick={() => onRespond(true, { allowAll: true })}
              className="w-full text-left px-4 py-2.5 rounded-lg bg-claude-bg hover:bg-claude-surface transition-colors group"
            >
              <span className="text-claude-text-muted mr-2">2.</span>
              <span className="text-claude-text group-hover:text-white">Yes, and don't ask again for similar commands</span>
            </button>

            <button
              onClick={() => setShowCustomInput(true)}
              className="w-full text-left px-4 py-2.5 rounded-lg bg-claude-bg hover:bg-claude-surface transition-colors group"
            >
              <span className="text-claude-text-muted mr-2">3.</span>
              <span className="text-claude-text group-hover:text-white">Type here to tell Claude what to do differently</span>
            </button>

            <div className="text-claude-text-muted text-sm pt-2">
              <button
                onClick={() => onRespond(false)}
                className="hover:text-claude-text transition-colors"
              >
                Press Esc to cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customMessage.trim()) {
                  handleCustomSubmit()
                } else if (e.key === 'Escape') {
                  setShowCustomInput(false)
                  setCustomMessage('')
                }
              }}
              placeholder="Tell Claude what to do differently..."
              autoFocus
              className="w-full bg-claude-bg border border-claude-border rounded-lg px-4 py-2.5 text-claude-text placeholder-claude-text-muted focus:outline-none focus:border-claude-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCustomSubmit}
                disabled={!customMessage.trim()}
                className="flex-1 bg-claude-accent hover:bg-claude-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
              >
                Send
              </button>
              <button
                onClick={() => {
                  setShowCustomInput(false)
                  setCustomMessage('')
                }}
                className="px-4 py-2 text-claude-text-muted hover:text-claude-text transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
