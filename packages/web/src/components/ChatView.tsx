import { useEffect, useRef, useCallback, memo, useState, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ChatMessage, ImageBlock } from '@sidecar/shared'
import { getTextContent, getImageBlocks } from '@sidecar/shared'
import { ToolCard } from './ToolCard'

// Parse command message format from user messages
interface ParsedCommand {
  name: string
  message: string
  args: string
  stdout: string
}

interface ParsedUserMessage {
  type: 'command' | 'text' | 'stdout'
  command?: ParsedCommand
  stdout?: string
  text?: string
}

function parseUserMessage(text: string): ParsedUserMessage {
  // Check if this is a command message (contains command XML tags)
  const commandNameMatch = text.match(/<command-name>(.*?)<\/command-name>/s)
  const commandMessageMatch = text.match(/<command-message>(.*?)<\/command-message>/s)
  const commandArgsMatch = text.match(/<command-args>(.*?)<\/command-args>/s)
  const stdoutMatch = text.match(/<local-command-stdout>(.*?)<\/local-command-stdout>/s)

  if (commandNameMatch) {
    // This is a command message with the command name
    const name = commandNameMatch[1].trim()
    return {
      type: 'command',
      command: {
        // Remove leading slash if already present to avoid double-slash
        name: name.startsWith('/') ? name.slice(1) : name,
        message: commandMessageMatch?.[1].trim() || '',
        args: commandArgsMatch?.[1].trim() || '',
        stdout: stdoutMatch?.[1].trim() || '',
      },
    }
  }

  // Check if this is ONLY a stdout message (separate from command)
  if (stdoutMatch && text.trim() === `<local-command-stdout>${stdoutMatch[1]}</local-command-stdout>`) {
    return {
      type: 'stdout',
      stdout: stdoutMatch[1].trim(),
    }
  }

  // Regular text message
  return {
    type: 'text',
    text: text.trim(),
  }
}

// Terminal-style command display component
function CommandDisplay({ command }: { command: ParsedCommand }) {
  return (
    <div className="font-mono text-sm">
      <div className="flex items-start gap-2">
        <span className="text-claude-text-muted select-none">&gt;</span>
        <span className="text-claude-text font-medium">/{command.name}</span>
        {command.args && (
          <span className="text-claude-text-muted">{command.args}</span>
        )}
      </div>
      {command.stdout && (
        <div className="ml-4 mt-1 text-claude-text-muted flex items-start gap-1">
          <span className="select-none">└</span>
          <span>{command.stdout}</span>
        </div>
      )}
    </div>
  )
}

// Get image source URL (data URL for base64, or regular URL)
function getImageSrc(image: ImageBlock): string {
  if (image.source.type === 'base64' && image.source.data) {
    return `data:${image.source.media_type};base64,${image.source.data}`
  }
  return image.source.url || ''
}

// Image popup overlay
function ImagePopup({ image, onClose }: { image: ImageBlock; onClose: () => void }) {
  const src = getImageSrc(image)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]">
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white hover:text-claude-coral transition-colors"
        >
          Close
        </button>
        <img
          src={src}
          alt="Attached image"
          className="max-w-full max-h-[85vh] object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}

// Clickable image link
function ImageLink({ index, onClick }: { index: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-claude-coral hover:text-claude-coral/80 underline text-sm"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
        <circle cx="9" cy="9" r="2"/>
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
      </svg>
      Image {index + 1}
    </button>
  )
}

interface ChatViewProps {
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  isProcessing?: boolean
}

export function ChatView({ messages, loading, sending, isProcessing }: ChatViewProps) {
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
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
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
      className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-40"
      style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 12px) + 48px)' }}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {(sending || isProcessing) && (
          <div className="flex gap-1 py-2">
            <span key="dot-1" className="thinking-dot w-2 h-2 rounded-full"></span>
            <span key="dot-2" className="thinking-dot w-2 h-2 rounded-full"></span>
            <span key="dot-3" className="thinking-dot w-2 h-2 rounded-full"></span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const [popupImage, setPopupImage] = useState<ImageBlock | null>(null)

  const textContent = getTextContent(message)
  const imageBlocks = getImageBlocks(message)

  // Parse user messages to detect commands
  const parsedUserMessage = useMemo(() => {
    if (isUser && textContent) {
      return parseUserMessage(textContent)
    }
    return null
  }, [isUser, textContent])

  if (isUser) {
    // Stdout-only messages (part of command output shown separately)
    if (parsedUserMessage?.type === 'stdout') {
      return (
        <div className="bg-claude-user-bubble rounded-2xl px-4 py-3">
          <div className="font-mono text-sm text-claude-text-muted flex items-start gap-1">
            <span className="select-none ml-4">└</span>
            <span>{parsedUserMessage.stdout}</span>
          </div>
        </div>
      )
    }

    // Check if this is a command message
    if (parsedUserMessage?.type === 'command' && parsedUserMessage.command) {
      return (
        <>
          {popupImage && <ImagePopup image={popupImage} onClose={() => setPopupImage(null)} />}
          <div className="bg-claude-user-bubble rounded-2xl px-4 py-3">
            <CommandDisplay command={parsedUserMessage.command} />
            {imageBlocks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {imageBlocks.map((img, i) => (
                  <ImageLink key={i} index={i} onClick={() => setPopupImage(img)} />
                ))}
              </div>
            )}
          </div>
        </>
      )
    }

    // Regular user message (with caveat stripped if present)
    const displayText = parsedUserMessage?.text || textContent
    return (
      <>
        {popupImage && <ImagePopup image={popupImage} onClose={() => setPopupImage(null)} />}
        <div className="bg-claude-user-bubble rounded-2xl px-4 py-3">
          <div className="whitespace-pre-wrap break-words text-[15px] text-claude-text">
            {displayText}
          </div>
          {imageBlocks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {imageBlocks.map((img, i) => (
                <ImageLink key={i} index={i} onClick={() => setPopupImage(img)} />
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  // Assistant messages flow naturally without bubble
  return (
    <>
      {popupImage && <ImagePopup image={popupImage} onClose={() => setPopupImage(null)} />}
      <div className="space-y-3">
        {textContent && (
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
              {textContent}
            </Markdown>
          </div>
        )}

        {imageBlocks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {imageBlocks.map((img, i) => (
              <ImageLink key={i} index={i} onClick={() => setPopupImage(img)} />
            ))}
          </div>
        )}

        {message.toolCalls && message.toolCalls.filter(t => t.name !== 'TodoWrite').length > 0 && (
          <div className="space-y-1">
            {message.toolCalls
              .filter((tool) => tool.name !== 'TodoWrite')
              .map((tool, idx) => (
                <ToolCard key={tool.id || `tool-${idx}`} tool={tool} />
              ))}
          </div>
        )}
      </div>
    </>
  )
})
