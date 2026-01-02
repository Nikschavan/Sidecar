import { useEffect, useRef, useCallback, memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
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
        <div className="text-claude-text-muted">Loading messages...</div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center text-claude-text-muted">
          <div className="text-4xl mb-4">Code</div>
          <div className="text-sm mt-2">Send a message to get started</div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {sending && (
          <div className="flex gap-1 py-2">
            <span className="thinking-dot w-2 h-2 rounded-full"></span>
            <span className="thinking-dot w-2 h-2 rounded-full"></span>
            <span className="thinking-dot w-2 h-2 rounded-full"></span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    // User messages get a subtle bubble
    return (
      <div className="bg-claude-user-bubble rounded-2xl px-4 py-3">
        <div className="whitespace-pre-wrap break-words text-[15px] text-claude-text">
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant messages flow naturally without bubble
  return (
    <div className="space-y-3">
      {message.content && (
        <div className="prose prose-sm prose-invert max-w-none text-claude-text leading-relaxed overflow-hidden break-words
          prose-p:my-2 prose-p:leading-relaxed
          prose-headings:text-claude-text prose-headings:font-semibold
          prose-strong:text-claude-text prose-strong:font-semibold
          prose-code:text-claude-coral prose-code:bg-claude-surface prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-code:break-all
          prose-pre:bg-claude-surface prose-pre:border prose-pre:border-claude-border prose-pre:rounded-lg prose-pre:overflow-x-auto
          prose-li:my-0.5
          prose-ol:my-2 prose-ul:my-2
          prose-table:border-collapse prose-table:w-full prose-table:my-4
          prose-th:border prose-th:border-claude-border prose-th:bg-claude-surface prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold
          prose-td:border prose-td:border-claude-border prose-td:px-3 prose-td:py-2">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const isInline = !match && !String(children).includes('\n')
                return isInline ? (
                  <code className={className} {...props}>
                    {children}
                  </code>
                ) : (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match ? match[1] : 'text'}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                    }}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                )
              },
            }}
          >
            {message.content}
          </Markdown>
        </div>
      )}

      {message.toolCalls && message.toolCalls.filter(t => t.name !== 'TodoWrite').length > 0 && (
        <div className="space-y-1">
          {message.toolCalls
            .filter((tool) => tool.name !== 'TodoWrite')
            .map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
        </div>
      )}
    </div>
  )
})
