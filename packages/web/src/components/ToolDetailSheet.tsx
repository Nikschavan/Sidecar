import { useEffect, useRef, useMemo, useState } from 'react'
import { diffLines } from 'diff'
import { CloseIcon } from './ToolIcons'

interface ToolCall {
  id: string
  name: string
  input: unknown
  result?: string
  isError?: boolean
}

interface ToolDetailSheetProps {
  tool: ToolCall
  isOpen: boolean
  onClose: () => void
}

// Helper to safely get string from input
function getString(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

// Get tool title for display
function getToolTitle(tool: ToolCall): string {
  const { name, input } = tool

  switch (name) {
    case 'Read': {
      const path = getString(input, ['file_path', 'path', 'file'])
      return path || 'Read'
    }
    case 'Edit': {
      const path = getString(input, ['file_path', 'path'])
      return path || 'Edit'
    }
    case 'Write': {
      const path = getString(input, ['file_path', 'path'])
      return path || 'Write'
    }
    case 'Bash': {
      const desc = getString(input, ['description'])
      return desc || 'Bash'
    }
    case 'Task': {
      const desc = getString(input, ['description'])
      return desc || 'Task'
    }
    case 'Skill': {
      const skill = getString(input, ['skill'])
      return skill ? `Skill: ${skill}` : 'Skill'
    }
    default:
      return name
  }
}

// Diff View for Edit tool
function DiffView({ oldString, newString }: { oldString: string; newString: string }) {
  const diffParts = useMemo(() => diffLines(oldString || '', newString || ''), [oldString, newString])

  return (
    <div className="rounded-lg overflow-hidden border border-claude-border bg-claude-bg-lighter">
      <div className="font-mono text-xs">
        {diffParts.map((part, i) => {
          const lines = part.value.split('\n')
          if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop()
          }

          if (lines.length === 0) return null

          const prefix = part.added ? '+' : part.removed ? '-' : ' '

          return (
            <div
              key={i}
              className={
                part.added
                  ? 'bg-green-950/40'
                  : part.removed
                  ? 'bg-red-950/40'
                  : ''
              }
            >
              {lines.map((line, j) => (
                <div key={j} className="flex">
                  <span
                    className={`w-6 text-center shrink-0 select-none ${
                      part.added
                        ? 'text-green-400 bg-green-950/60'
                        : part.removed
                        ? 'text-red-400 bg-red-950/60'
                        : 'text-claude-text-dim'
                    }`}
                  >
                    {prefix}
                  </span>
                  <span
                    className={`pl-2 pr-2 whitespace-pre-wrap break-all min-w-0 ${
                      part.added
                        ? 'text-green-300'
                        : part.removed
                        ? 'text-red-300'
                        : 'text-claude-text-muted'
                    }`}
                  >
                    {line}
                  </span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Code block for displaying content
function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div>
      {label && (
        <div className="text-xs text-claude-text-dim mb-1 font-medium">{label}</div>
      )}
      <div className="rounded-lg bg-claude-bg-lighter overflow-hidden border border-claude-border p-3">
        <pre className="font-mono text-xs text-claude-text-muted whitespace-pre-wrap break-all overflow-auto max-h-64">
          {code}
        </pre>
      </div>
    </div>
  )
}

// Render tool-specific input content
function renderToolInput(tool: ToolCall): React.ReactNode {
  const input = tool.input as Record<string, unknown>

  switch (tool.name) {
    case 'Edit': {
      const oldString = input.old_string as string | undefined
      const newString = input.new_string as string | undefined
      const filePath = getString(input, ['file_path', 'path'])
      if (oldString !== undefined || newString !== undefined) {
        return (
          <div className="space-y-2">
            {filePath && (
              <div className="font-mono text-xs text-claude-text-dim break-all">{filePath}</div>
            )}
            <DiffView oldString={oldString || ''} newString={newString || ''} />
          </div>
        )
      }
      break
    }

    case 'Write': {
      const content = input.content as string | undefined
      const filePath = getString(input, ['file_path', 'path'])
      if (content) {
        return (
          <div className="space-y-2">
            {filePath && (
              <div className="font-mono text-xs text-claude-text-dim break-all">{filePath}</div>
            )}
            <CodeBlock code={content} />
          </div>
        )
      }
      break
    }

    case 'Read': {
      const filePath = getString(input, ['file_path', 'path', 'file'])
      if (filePath) {
        return <div className="font-mono text-xs text-claude-text-muted break-all">{filePath}</div>
      }
      break
    }

    case 'Bash': {
      const command = getString(input, ['command', 'cmd'])
      if (command) {
        return <CodeBlock code={command} label="Command" />
      }
      break
    }

    case 'Glob': {
      const pattern = getString(input, ['pattern'])
      const path = getString(input, ['path'])
      return (
        <div className="space-y-2">
          {pattern && <CodeBlock code={pattern} label="Pattern" />}
          {path && <div className="font-mono text-xs text-claude-text-dim">Path: {path}</div>}
        </div>
      )
    }

    case 'Grep': {
      const pattern = getString(input, ['pattern'])
      const path = getString(input, ['path'])
      const glob = getString(input, ['glob'])
      return (
        <div className="space-y-2">
          {pattern && <CodeBlock code={pattern} label="Pattern" />}
          {path && <div className="font-mono text-xs text-claude-text-dim">Path: {path}</div>}
          {glob && <div className="font-mono text-xs text-claude-text-dim">Glob: {glob}</div>}
        </div>
      )
    }

    case 'WebFetch': {
      const url = getString(input, ['url'])
      const prompt = getString(input, ['prompt'])
      return (
        <div className="space-y-2">
          {url && <div className="font-mono text-xs text-claude-coral break-all">{url}</div>}
          {prompt && <CodeBlock code={prompt} label="Prompt" />}
        </div>
      )
    }

    case 'WebSearch': {
      const query = getString(input, ['query'])
      if (query) {
        return <CodeBlock code={query} label="Query" />
      }
      break
    }

    case 'Task': {
      const prompt = getString(input, ['prompt'])
      const description = getString(input, ['description'])
      return (
        <div className="space-y-2">
          {description && <div className="text-sm text-claude-text">{description}</div>}
          {prompt && <CodeBlock code={prompt} label="Prompt" />}
        </div>
      )
    }

    case 'Skill': {
      const skill = getString(input, ['skill'])
      const args = getString(input, ['args'])
      return (
        <div className="space-y-2">
          {skill && <div className="font-mono text-sm text-claude-coral">{skill}</div>}
          {args && <CodeBlock code={args} label="Arguments" />}
        </div>
      )
    }

    case 'AskUserQuestion': {
      const questions = Array.isArray(input.questions) ? input.questions : []
      return (
        <div className="space-y-3">
          {questions.map((q: Record<string, unknown>, i: number) => (
            <div key={i} className="space-y-1">
              <div className="text-xs text-claude-text-dim font-medium">
                {(q.header as string) || `Question ${i + 1}`}
              </div>
              <div className="text-sm text-claude-text">{q.question as string}</div>
            </div>
          ))}
        </div>
      )
    }

    case 'EnterPlanMode':
    case 'ExitPlanMode': {
      const plan = getString(input, ['plan'])
      if (plan) {
        return <CodeBlock code={plan} label="Plan" />
      }
      return <div className="text-sm text-claude-text-muted">Plan mode transition</div>
    }
  }

  // Default: show JSON of input
  try {
    const jsonStr = JSON.stringify(input, null, 2)
    if (jsonStr !== '{}') {
      return <CodeBlock code={jsonStr} />
    }
  } catch {
    // ignore
  }
  return null
}

export function ToolDetailSheet({ tool, isOpen, onClose }: ToolDetailSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [startY, setStartY] = useState<number | null>(null)
  const [currentY, setCurrentY] = useState<number | null>(null)

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Add listener with a small delay to avoid immediate trigger
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Handle touch/swipe to dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === null) return
    setCurrentY(e.touches[0].clientY)
  }

  const handleTouchEnd = () => {
    if (startY !== null && currentY !== null) {
      const diff = currentY - startY
      if (diff > 100) {
        onClose()
      }
    }
    setStartY(null)
    setCurrentY(null)
  }

  if (!isOpen) return null

  const title = getToolTitle(tool)
  const inputContent = renderToolInput(tool)

  // Calculate transform for swipe gesture
  const translateY = startY !== null && currentY !== null
    ? Math.max(0, currentY - startY)
    : 0

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center">
      <div
        ref={sheetRef}
        className="w-[calc(100%-2rem)] bg-claude-bg-light border-t border-x border-claude-border rounded-t-2xl max-h-[80vh] flex flex-col transition-transform duration-200 ease-out"
        style={{ transform: `translateY(${translateY}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-claude-border rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-claude-border">
          <h2 className="text-base font-semibold text-claude-text truncate flex-1 mr-2">
            {tool.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-claude-surface text-claude-text-muted hover:text-claude-text transition-colors"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Subtitle/path if different from tool name */}
          {title !== tool.name && (
            <div className="font-mono text-xs text-claude-text-muted break-all">
              {title}
            </div>
          )}

          {/* Input section */}
          {inputContent && (
            <div>
              <div className="text-xs font-medium text-claude-text-dim mb-2">Input</div>
              {inputContent}
            </div>
          )}

          {/* Result section */}
          {tool.result && (
            <div>
              <div className="text-xs font-medium text-claude-text-dim mb-2">Output</div>
              <div className={`rounded-lg bg-claude-bg-lighter border border-claude-border p-3 overflow-auto max-h-64 ${
                tool.isError ? 'border-red-500/50' : ''
              }`}>
                <pre className={`font-mono text-xs whitespace-pre-wrap break-all ${
                  tool.isError ? 'text-red-400' : 'text-claude-text-muted'
                }`}>
                  {tool.result}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
