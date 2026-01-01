import { useEffect, useRef, useCallback } from 'react'
import type { ChatMessage } from '@sidecar/shared'
import { ToolCard } from './ToolCard'

interface ChatViewProps {
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
}

export function ChatView({ messages, loading, sending }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const prevMessageCount = useRef(0)

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    // Check if user is near the bottom (within 100px)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    userScrolledUp.current = !isNearBottom
  }, [])

  useEffect(() => {
    // Reset scroll state when switching sessions (message count drops significantly)
    if (messages.length < prevMessageCount.current - 1) {
      userScrolledUp.current = false
    }
    prevMessageCount.current = messages.length

    // Only auto-scroll if user hasn't scrolled up
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-slate-400">Loading messages...</div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center text-slate-400">
          <div className="text-4xl mb-4">👋</div>
          <div className="text-lg">No messages yet</div>
          <div className="text-sm mt-2">Send a message to Claude</div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-4 space-y-4"
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      
      {sending && (
        <div className="flex justify-start">
          <div className="message-assistant px-4 py-3 max-w-[85%]">
            <div className="flex gap-1">
              <span className="thinking-dot w-2 h-2 bg-slate-400 rounded-full"></span>
              <span className="thinking-dot w-2 h-2 bg-slate-400 rounded-full"></span>
              <span className="thinking-dot w-2 h-2 bg-slate-400 rounded-full"></span>
            </div>
          </div>
        </div>
      )}
      
      <div ref={bottomRef} />
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-4 py-3 max-w-[85%] ${
          isUser ? 'message-user' : 'message-assistant'
        }`}
      >
        <div className="whitespace-pre-wrap break-words text-sm">
          {message.content}
        </div>
        
        {message.toolCalls && message.toolCalls.filter(t => t.name !== 'TodoWrite').length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-600/50 space-y-1">
            {message.toolCalls
              .filter((tool) => tool.name !== 'TodoWrite')
              .map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
