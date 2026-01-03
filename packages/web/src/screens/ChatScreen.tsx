import type { ChatMessage, ImageBlock } from '@sidecar/shared'
import { ChatView } from '../components/ChatView'
import { InputBar, type SlashCommand, type SessionSettings } from '../components/InputBar'
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
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  isProcessing: boolean
  pendingPermission: PendingPermission | null
  slashCommands?: SlashCommand[]
  settings?: SessionSettings
  onSend: (text: string, images?: ImageBlock[]) => void
  onBack: () => void
  onPermissionResponse: (allow: boolean, options?: { answers?: Record<string, string[]>; allowAll?: boolean; customMessage?: string }) => void
  onSettingsChange?: (settings: SessionSettings) => void
  onAbort?: () => void
}

export function ChatScreen({
  sessionId: _sessionId,
  sessionName,
  messages,
  loading,
  sending,
  isProcessing,
  pendingPermission,
  slashCommands,
  settings,
  onSend,
  onBack,
  onPermissionResponse,
  onSettingsChange,
  onAbort
}: ChatScreenProps) {
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

        <h1 className="text-base font-medium text-claude-text truncate">
          {sessionName || 'Untitled session'}
        </h1>
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
        slashCommands={slashCommands}
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
    </div>
  )
}
