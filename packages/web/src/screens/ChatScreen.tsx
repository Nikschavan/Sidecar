import type { ChatMessage } from '@sidecar/shared'
import { ChatView } from '../components/ChatView'
import { InputBar } from '../components/InputBar'

interface ChatScreenProps {
  sessionId: string
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  onSend: (text: string) => void
  onBack: () => void
}

export function ChatScreen({
  sessionId,
  messages,
  loading,
  sending,
  onSend,
  onBack
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

      {/* Input bar */}
      <InputBar
        onSend={onSend}
        disabled={sending}
        placeholder="Message Claude..."
      />
    </div>
  )
}
