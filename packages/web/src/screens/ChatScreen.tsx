import type { ChatMessage } from '@sidecar/shared'
import { ChatView } from '../components/ChatView'
import { InputBar } from '../components/InputBar'

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
}

interface ChatScreenProps {
  sessionId: string
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  pendingPermission: PendingPermission | null
  onSend: (text: string) => void
  onBack: () => void
  onPermissionResponse: (allow: boolean) => void
}

export function ChatScreen({
  sessionId,
  messages,
  loading,
  sending,
  pendingPermission,
  onSend,
  onBack,
  onPermissionResponse
}: ChatScreenProps) {
  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <header
        className="bg-slate-800 border-b border-slate-700 px-4 flex items-center gap-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}
      >
        <button
          onClick={onBack}
          className="p-2 -ml-2 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-200 truncate">
            Session
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {sessionId.slice(0, 16)}...
          </div>
        </div>
      </header>

      {/* Chat messages */}
      <ChatView
        messages={messages}
        loading={loading}
        sending={sending}
      />

      {/* Permission prompt */}
      {pendingPermission && (
        <div className="bg-amber-900/50 border-t border-amber-700 p-4">
          <div className="text-sm text-amber-200 mb-2">
            Claude wants to use <span className="font-semibold">{pendingPermission.toolName}</span>
          </div>
          <div className="text-xs text-amber-300/70 mb-3 font-mono bg-amber-950/50 p-2 rounded overflow-x-auto max-h-24 overflow-y-auto">
            {JSON.stringify(pendingPermission.input, null, 2)}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onPermissionResponse(true)}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              Allow
            </button>
            <button
              onClick={() => onPermissionResponse(false)}
              className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <InputBar
        onSend={onSend}
        disabled={sending || !!pendingPermission}
        placeholder={pendingPermission ? "Respond to permission request above..." : "Message Claude..."}
      />
    </div>
  )
}
