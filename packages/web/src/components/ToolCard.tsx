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

// Max length before truncating
const MAX_RESULT_LENGTH = 300

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

    default: {
      return getString(input, ['file_path', 'path', 'command', 'pattern', 'query'])
    }
  }
}

export function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false)
  const detail = getToolDetail(tool)

  const hasResult = tool.result !== undefined
  const resultIsTruncated = hasResult && tool.result!.length > MAX_RESULT_LENGTH
  const displayResult = hasResult
    ? (expanded || !resultIsTruncated ? tool.result : tool.result!.slice(0, MAX_RESULT_LENGTH) + '...')
    : null

  return (
    <div className="py-1.5">
      {/* Tool name and detail inline */}
      <div className="flex items-start gap-2">
        {tool.isError && (
          <svg className="w-4 h-4 text-claude-tool-name shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-claude-tool-name">{tool.name}</span>
          {detail && (
            <span className="text-sm text-claude-text-muted ml-2 font-mono">
              {truncate(detail, 60)}
            </span>
          )}
        </div>
      </div>

      {/* Tool result display */}
      {displayResult && (
        <div className="mt-2">
          <div
            className={`text-xs font-mono p-3 rounded-lg bg-claude-bg-lighter overflow-x-auto whitespace-pre-wrap break-words ${
              tool.isError ? 'text-claude-tool-name' : 'text-claude-text-muted'
            }`}
            style={{ maxHeight: expanded ? 'none' : '120px', overflow: expanded ? 'visible' : 'hidden' }}
          >
            {displayResult}
          </div>
          {resultIsTruncated && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-claude-accent hover:text-claude-accent-hover mt-1.5"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
