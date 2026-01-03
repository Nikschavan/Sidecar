import { useState } from 'react'

interface ToolCall {
  id: string
  name: string
  input: unknown
  result?: string
  isError?: boolean
}

interface ToolCardProps {
  tool: ToolCall
}

// Max lines before truncating
const MAX_LINES = 20

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

// Helper to truncate text
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

// Get tool detail string for display
function getToolDetail(tool: ToolCall): string | null {
  const { name, input } = tool

  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write': {
      return getString(input, ['file_path', 'path', 'file'])
    }

    case 'Bash': {
      return getString(input, ['command', 'cmd'])
    }

    case 'Glob': {
      return getString(input, ['pattern'])
    }

    case 'Grep': {
      return getString(input, ['pattern'])
    }

    case 'WebFetch': {
      const url = getString(input, ['url'])
      if (url) {
        try {
          return new URL(url).hostname
        } catch {
          return truncate(url, 40)
        }
      }
      return null
    }

    case 'WebSearch': {
      return getString(input, ['query'])
    }

    case 'Task': {
      return getString(input, ['description']) || getString(input, ['prompt'])
    }

    case 'AskUserQuestion': {
      // Don't show detail for AskUserQuestion - handled in renderToolContent
      return null
    }

    default: {
      return getString(input, ['file_path', 'path', 'command', 'pattern', 'query'])
    }
  }
}

// Parse AskUserQuestion result to extract answers
interface AskUserQuestionAnswer {
  question: string
  header: string
  answer: string
}

function parseAskUserQuestionResult(input: unknown, result: string | undefined): AskUserQuestionAnswer[] {
  if (!result || !input || typeof input !== 'object') return []

  const inp = input as Record<string, unknown>
  const questions = Array.isArray(inp.questions) ? inp.questions : []

  // Result format from Claude: "User has answered your questions: \"Question\"=\"Answer\", \"Question2\"=\"Answer2\", ..."
  // Parse this string format to extract question-answer pairs
  const answersMap = new Map<string, string>()

  // Match patterns like "Question text"="Answer text"
  const regex = /"([^"]+)"="([^"]*)"/g
  let match
  while ((match = regex.exec(result)) !== null) {
    answersMap.set(match[1], match[2])
  }

  const parsed: AskUserQuestionAnswer[] = []

  questions.forEach((q: Record<string, unknown>) => {
    const questionText = (q.question as string) || ''
    const header = (q.header as string) || ''

    // Try to find answer by question text
    const answer = answersMap.get(questionText)

    if (answer !== undefined) {
      parsed.push({
        question: questionText,
        header: header,
        answer: answer
      })
    }
  })

  return parsed
}

// Render AskUserQuestion with answers
function AskUserQuestionView({ input, result }: { input: unknown; result?: string }) {
  const answers = parseAskUserQuestionResult(input, result)

  if (answers.length === 0) {
    // No answers yet - show pending state
    return null
  }

  return (
    <div className="mt-2 font-mono text-sm">
      {answers.map((item, i) => (
        <div key={i} className="flex items-start gap-1 text-claude-text-muted">
          <span className="select-none">└</span>
          <span className="text-claude-text-dim">·</span>
          <span className="flex-1">
            <span>{item.header || item.question}</span>
            <span className="mx-1">→</span>
            <span className="text-claude-coral">{item.answer}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// Render diff-style content for Edit tool
function DiffView({ oldString, newString, expanded, onToggle }: {
  oldString?: string
  newString?: string
  expanded: boolean
  onToggle: () => void
}) {
  // Generate simple diff lines
  const oldLines = oldString?.split('\n') || []
  const newLines = newString?.split('\n') || []

  const diffLines: Array<{ type: 'remove' | 'add' | 'context'; content: string; lineNum: number }> = []

  // Show removed lines (old_string)
  oldLines.forEach((line, i) => {
    diffLines.push({ type: 'remove', content: line, lineNum: i + 1 })
  })

  // Show added lines (new_string)
  newLines.forEach((line, i) => {
    diffLines.push({ type: 'add', content: line, lineNum: i + 1 })
  })

  const visibleLines = expanded ? diffLines : diffLines.slice(0, MAX_LINES)
  const hasMore = diffLines.length > MAX_LINES

  return (
    <div className="mt-2">
      <div className="rounded-lg bg-claude-bg-lighter overflow-hidden border border-claude-border">
        <div className="text-xs font-mono">
          {visibleLines.map((line, i) => (
            <div
              key={i}
              className={`flex ${
                line.type === 'remove'
                  ? 'bg-red-950/30'
                  : line.type === 'add'
                  ? 'bg-green-950/30'
                  : ''
              }`}
            >
              <span className="w-8 text-right pr-2 text-claude-text-dim select-none shrink-0 border-r border-claude-border">
                {line.lineNum}
              </span>
              <span className={`w-4 text-center shrink-0 ${
                line.type === 'remove' ? 'text-red-400' : line.type === 'add' ? 'text-green-400' : ''
              }`}>
                {line.type === 'remove' ? '-' : line.type === 'add' ? '+' : ' '}
              </span>
              <span className={`pl-1 pr-2 whitespace-pre-wrap break-all min-w-0 ${
                line.type === 'remove' ? 'text-red-300' : line.type === 'add' ? 'text-green-300' : 'text-claude-text-muted'
              }`}>
                {line.content}
              </span>
            </div>
          ))}
        </div>
      </div>
      {hasMore && (
        <button
          onClick={onToggle}
          className="text-xs text-claude-text-muted hover:text-claude-text mt-1.5 w-full text-center py-1"
        >
          {expanded ? 'Show less' : `Show full diff (${diffLines.length - MAX_LINES} more lines)`}
        </button>
      )}
    </div>
  )
}

// Render content for Write tool (all additions)
function WriteView({ content, expanded, onToggle }: {
  content: string
  expanded: boolean
  onToggle: () => void
}) {
  const lines = content.split('\n')
  const visibleLines = expanded ? lines : lines.slice(0, MAX_LINES)
  const hasMore = lines.length > MAX_LINES

  return (
    <div className="mt-2">
      <div className="rounded-lg bg-claude-bg-lighter overflow-hidden border border-claude-border">
        <div className="text-xs font-mono">
          {visibleLines.map((line, i) => (
            <div key={i} className="flex bg-green-950/30">
              <span className="w-8 text-right pr-2 text-claude-text-dim select-none shrink-0 border-r border-claude-border">
                {i + 1}
              </span>
              <span className="w-4 text-center shrink-0 text-green-400">+</span>
              <span className="pl-1 pr-2 whitespace-pre-wrap break-all min-w-0 text-green-300">{line}</span>
            </div>
          ))}
        </div>
      </div>
      {hasMore && (
        <button
          onClick={onToggle}
          className="text-xs text-claude-text-muted hover:text-claude-text mt-1.5 w-full text-center py-1"
        >
          {expanded ? 'Show less' : `Show full content (${lines.length - MAX_LINES} more lines)`}
        </button>
      )}
    </div>
  )
}

export function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const detail = getToolDetail(tool)
  const input = tool.input as Record<string, unknown>

  // Special handling for different tools
  const renderToolContent = () => {
    switch (tool.name) {
      case 'Read':
        // Don't show file contents for Read, just the path
        return null

      case 'Edit': {
        const oldString = input.old_string as string | undefined
        const newString = input.new_string as string | undefined
        if (oldString || newString) {
          return (
            <DiffView
              oldString={oldString}
              newString={newString}
              expanded={expanded}
              onToggle={() => setExpanded(!expanded)}
            />
          )
        }
        return null
      }

      case 'Write': {
        const content = input.content as string | undefined
        if (content) {
          return (
            <WriteView
              content={content}
              expanded={expanded}
              onToggle={() => setExpanded(!expanded)}
            />
          )
        }
        return null
      }

      case 'AskUserQuestion': {
        return <AskUserQuestionView input={input} result={tool.result} />
      }

      default:
        // For other tools, show result if present
        if (tool.result) {
          const lines = tool.result.split('\n')
          const isTruncated = lines.length > MAX_LINES
          const visibleContent = expanded ? tool.result : lines.slice(0, MAX_LINES).join('\n')

          return (
            <div className="mt-2">
              <div
                className={`text-xs font-mono p-3 rounded-lg bg-claude-bg-lighter overflow-x-auto whitespace-pre-wrap break-words ${
                  tool.isError ? 'text-claude-tool-name' : 'text-claude-text-muted'
                }`}
              >
                {visibleContent}
                {!expanded && isTruncated && '...'}
              </div>
              {isTruncated && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs text-claude-accent hover:text-claude-accent-hover mt-1.5"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )
        }
        return null
    }
  }

  // Determine status: completed (has result), error, or pending
  const isCompleted = tool.result !== undefined
  const hasError = tool.isError

  return (
    <div className="py-1.5">
      {/* Tool name and detail inline */}
      <div className="flex items-start gap-2">
        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
          hasError
            ? 'bg-red-500'
            : isCompleted
            ? 'bg-green-500'
            : 'bg-claude-tool-name'
        }`} />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-claude-text">{tool.name}</span>
          {detail && (
            <span className="text-sm text-claude-text-muted ml-2 font-mono break-all">
              {detail}
            </span>
          )}
        </div>
      </div>

      {/* Tool-specific content */}
      {renderToolContent()}
    </div>
  )
}
