import { useState, useRef, useEffect } from 'react'

interface InputBarProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

export function InputBar({ onSend, disabled, placeholder = 'Add feedback...' }: InputBarProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }
  }, [text])

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
      <div className="flex items-end gap-3 max-w-3xl mx-auto">
        <div className="flex-1 bg-[#f5f3ef] rounded-2xl px-4 py-2 min-h-[44px] flex items-center">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent text-[15px] text-[#2a2624] resize-none focus:outline-none placeholder-[#9a9590] disabled:opacity-50"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="w-11 h-11 flex items-center justify-center bg-claude-accent rounded-full hover:bg-claude-accent-hover disabled:opacity-40 disabled:hover:bg-claude-accent transition-colors shrink-0"
        >
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
