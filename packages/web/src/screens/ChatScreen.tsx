import type { ChatMessage } from '@sidecar/shared'
import { ChatView } from '../components/ChatView'
import { InputBar } from '../components/InputBar'
import { AskUserQuestion } from '../components/AskUserQuestion'

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
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  pendingPermission: PendingPermission | null
  onSend: (text: string) => void
  onBack: () => void
  onPermissionResponse: (allow: boolean, options?: { answers?: Record<string, string[]>; allowAll?: boolean }) => void
}

export function ChatScreen({
  sessionId: _sessionId,
  sessionName,
  messages,
  loading,
  sending,
  pendingPermission,
  onSend,
  onBack,
  onPermissionResponse
}: ChatScreenProps) {
  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* Header */}
      <header
        className="px-4 flex items-center justify-between"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}
      >
        <button
          onClick={onBack}
          className="p-2 -ml-2 hover:bg-claude-bg-light rounded-full transition-colors"
        >
          <svg className="w-6 h-6 text-claude-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        <h1 className="text-base font-medium text-claude-text truncate max-w-[60%]">
          {sessionName || 'Untitled session'}
        </h1>

        <button className="p-2 -mr-2 hover:bg-claude-bg-light rounded-full transition-colors">
          <svg className="w-6 h-6 text-claude-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
        </button>
      </header>

      {/* Chat messages */}
      <ChatView
        messages={messages}
        loading={loading}
        sending={sending}
      />

      {/* AskUserQuestion dialog */}
      {pendingPermission && pendingPermission.toolName === 'AskUserQuestion' && (
        <AskUserQuestion
          input={pendingPermission.input}
          onSubmit={(answers) => onPermissionResponse(true, { answers })}
          onCancel={() => onPermissionResponse(false)}
        />
      )}

      {/* Generic permission prompt */}
      {pendingPermission && pendingPermission.toolName !== 'AskUserQuestion' && (
        <div className="bg-claude-bg-light border-t border-claude-border p-4">
          <div className="max-w-3xl mx-auto">
            <div className="text-sm text-claude-text mb-2">
              Claude wants to use <span className="font-semibold text-claude-tool-name">{pendingPermission.toolName}</span>
            </div>
            <div className="text-xs text-claude-text-muted mb-3 font-mono bg-claude-bg p-2 rounded-lg overflow-x-auto max-h-24 overflow-y-auto">
              {JSON.stringify(pendingPermission.input, null, 2)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onPermissionResponse(true)}
                className="flex-1 bg-green-700 hover:bg-green-600 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
              >
                Allow
              </button>
              <button
                onClick={() => onPermissionResponse(true, { allowAll: true })}
                className="flex-1 bg-blue-700 hover:bg-blue-600 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
              >
                Allow All
              </button>
              <button
                onClick={() => onPermissionResponse(false)}
                className="flex-1 bg-red-700 hover:bg-red-600 text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input bar */}
      <InputBar
        onSend={onSend}
        disabled={sending || !!pendingPermission}
        placeholder={pendingPermission ? "Respond to permission request above..." : "Add feedback..."}
      />
    </div>
  )
}
