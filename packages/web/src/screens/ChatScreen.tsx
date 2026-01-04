import { useState, useRef, useEffect } from 'react'
import type { ChatMessage, ImageBlock } from '@sidecar/shared'
import { ChatView } from '../components/ChatView'
import { InputBar, type SessionSettings } from '../components/InputBar'
import { AskUserQuestion } from '../components/AskUserQuestion'
import { PermissionDialog } from '../components/PermissionDialog'

interface PendingPermission {
  requestId: string
  sessionId: string
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  permissionSuggestions?: Array<{
    type: string
    mode?: string
    destination?: string
  }>
  source?: 'process' | 'file' // 'file' = detected from terminal session
}

interface ChatScreenProps {
  sessionId: string
  sessionName: string | null
  projectPath: string | null
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  isProcessing: boolean
  pendingPermission: PendingPermission | null
  settings?: SessionSettings
  onSend: (text: string, images?: ImageBlock[]) => void
  onBack: () => void
  onPermissionResponse: (allow: boolean, options?: { answers?: Record<string, string[]>; allowAll?: boolean; customMessage?: string }) => void
  onSettingsChange?: (settings: SessionSettings) => void
  onAbort?: () => void
}

export function ChatScreen({
  sessionId,
  sessionName,
  projectPath,
  messages,
  loading,
  sending,
  isProcessing,
  pendingPermission,
  settings,
  onSend,
  onBack,
  onPermissionResponse,
  onSettingsChange,
  onAbort
}: ChatScreenProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showTerminalPopup, setShowTerminalPopup] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const terminalCommand = projectPath
    ? `cd "${projectPath}" && claude --resume ${sessionId}`
    : `claude --resume ${sessionId}`

  const handleCopyCommand = async () => {
    try {
      // Use clipboard API if available (requires secure context)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(terminalCommand)
      } else {
        // Fallback for non-secure contexts (e.g., localhost without HTTPS)
        const textArea = document.createElement('textarea')
        textArea.value = terminalCommand
        textArea.style.position = 'fixed'
        textArea.style.left = '-9999px'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="h-full flex flex-col bg-claude-bg overflow-x-hidden relative">
      {/* Header */}
      <header
        className="fixed top-0 left-0 right-0 px-4 flex items-center gap-3 bg-claude-bg/95 backdrop-blur-sm z-10"
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

        <h1 className="flex-1 text-base font-medium text-claude-text truncate">
          {sessionName || 'Chat'}
        </h1>

        {/* Three-dot menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 -mr-2 hover:bg-claude-bg-light rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-claude-text" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-claude-bg-light border border-claude-border rounded-lg shadow-lg z-50 overflow-hidden">
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setShowTerminalPopup(true)
                }}
                className="w-full px-4 py-3 text-left text-sm text-claude-text hover:bg-claude-bg-lighter transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                </svg>
                Continue in terminal
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Terminal command popup */}
      {showTerminalPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-claude-bg-light border border-claude-border rounded-xl max-w-lg w-full shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border">
              <h2 className="text-base font-medium text-claude-text">Continue in Terminal</h2>
              <button
                onClick={() => setShowTerminalPopup(false)}
                className="p-1 hover:bg-claude-bg-lighter rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-claude-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-claude-text-secondary mb-3">
                Run this command in your terminal to continue this chat:
              </p>
              <div className="bg-claude-bg rounded-lg p-3 font-mono text-sm text-claude-text break-all">
                {terminalCommand}
              </div>
              <button
                onClick={handleCopyCommand}
                className={`mt-4 w-full py-2.5 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
                  copied
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-claude-orange hover:bg-claude-orange-dark'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                    Copy command
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat messages */}
      <ChatView
        messages={messages}
        loading={loading}
        sending={sending}
        isProcessing={isProcessing}
      />

      {/* AskUserQuestion dialog */}
      {pendingPermission && pendingPermission.toolName === 'AskUserQuestion' && (
        <AskUserQuestion
          input={pendingPermission.input}
          onSubmit={(answers) => onPermissionResponse(true, { answers })}
          onCancel={() => onPermissionResponse(false)}
        />
      )}

      {/* Permission dialog */}
      {pendingPermission && pendingPermission.toolName !== 'AskUserQuestion' && (
        <PermissionDialog
          toolName={pendingPermission.toolName}
          input={pendingPermission.input}
          onRespond={(allow, options) => onPermissionResponse(allow, options)}
        />
      )}

      {/* Input bar */}
      <InputBar
        onSend={onSend}
        onAbort={onAbort}
        isProcessing={isProcessing}
        disabled={sending || !!pendingPermission}
        placeholder={pendingPermission ? "Respond to permission request above..." : "Type a message..."}
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
    </div>
  )
}
