import { useState, type ReactNode } from 'react'
import { ToolDetailSheet } from './ToolDetailSheet'
import {
  TerminalIcon,
  SearchIcon,
  EyeIcon,
  FileDiffIcon,
  GlobeIcon,
  BulbIcon,
  RocketIcon,
  WrenchIcon,
  QuestionIcon,
  SkillIcon,
  PlanIcon,
  ChevronRightIcon,
} from './ToolIcons'

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

// Tool icon mapping
function getToolIcon(name: string): ReactNode {
  const iconClass = 'h-3.5 w-3.5'

  switch (name) {
    case 'Bash':
      return <TerminalIcon className={iconClass} />
    case 'Read':
      return <EyeIcon className={iconClass} />
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return <FileDiffIcon className={iconClass} />
    case 'Glob':
      return <SearchIcon className={iconClass} />
    case 'Grep':
      return <EyeIcon className={iconClass} />
    case 'WebFetch':
    case 'WebSearch':
      return <GlobeIcon className={iconClass} />
    case 'Task':
      return <RocketIcon className={iconClass} />
    case 'TodoWrite':
      return <BulbIcon className={iconClass} />
    case 'AskUserQuestion':
      return <QuestionIcon className={iconClass} />
    case 'Skill':
      return <SkillIcon className={iconClass} />
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return <PlanIcon className={iconClass} />
    case 'TaskOutput':
    case 'KillShell':
      return <TerminalIcon className={iconClass} />
    default:
      if (name.startsWith('mcp__')) {
        return <WrenchIcon className={iconClass} />
      }
      return <WrenchIcon className={iconClass} />
  }
}

// Get tool title (primary display text)
function getToolTitle(tool: ToolCall): string {
  const { name, input } = tool

  switch (name) {
    case 'Bash': {
      const desc = getString(input, ['description'])
      return desc || 'Terminal'
    }
    case 'Read': {
      const path = getString(input, ['file_path', 'path', 'file'])
      return path ? truncate(path, 60) : 'Read file'
    }
    case 'Edit': {
      const path = getString(input, ['file_path', 'path'])
      return path ? truncate(path, 60) : 'Edit file'
    }
    case 'Write': {
      const path = getString(input, ['file_path', 'path'])
      return path ? truncate(path, 60) : 'Write file'
    }
    case 'Glob': {
      const pattern = getString(input, ['pattern'])
      return pattern ? truncate(pattern, 60) : 'Search files'
    }
    case 'Grep': {
      const pattern = getString(input, ['pattern'])
      return pattern ? `grep(${truncate(pattern, 50)})` : 'Search content'
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
      return 'Web fetch'
    }
    case 'WebSearch': {
      const query = getString(input, ['query'])
      return query ? truncate(query, 60) : 'Web search'
    }
    case 'Task': {
      const desc = getString(input, ['description'])
      return desc || 'Task'
    }
    case 'TodoWrite':
      return 'Todo list'
    case 'AskUserQuestion': {
      const inp = input as Record<string, unknown>
      const questions = Array.isArray(inp.questions) ? inp.questions : []
      if (questions.length > 1) {
        return `${questions.length} Questions`
      }
      const first = questions[0] as Record<string, unknown> | undefined
      const header = first?.header as string
      return header || 'Question'
    }
    case 'Skill': {
      const skill = getString(input, ['skill'])
      return skill || 'Skill'
    }
    case 'EnterPlanMode':
      return 'Entering plan mode'
    case 'ExitPlanMode':
      return 'Plan proposal'
    case 'TaskOutput':
      return 'Task output'
    case 'KillShell':
      return 'Kill shell'
    default:
      return name
  }
}

// Get tool subtitle (secondary info)
function getToolSubtitle(tool: ToolCall): string | null {
  const { name, input } = tool

  switch (name) {
    case 'Bash': {
      const cmd = getString(input, ['command', 'cmd'])
      return cmd ? truncate(cmd, 80) : null
    }
    case 'Write': {
      const content = getString(input, ['content', 'text'])
      if (!content) return null
      const lines = content.split('\n').length
      return lines > 1 ? `${lines} lines` : `${content.length} chars`
    }
    case 'Task': {
      const prompt = getString(input, ['prompt'])
      return prompt ? truncate(prompt, 80) : null
    }
    case 'WebFetch': {
      const url = getString(input, ['url'])
      return url ? truncate(url, 80) : null
    }
    case 'TodoWrite': {
      const inp = input as Record<string, unknown>
      const todos = Array.isArray(inp.todos) ? inp.todos : []
      if (todos.length > 0) return `${todos.length} items`
      return null
    }
    case 'AskUserQuestion': {
      const inp = input as Record<string, unknown>
      const questions = Array.isArray(inp.questions) ? inp.questions : []
      const first = questions[0] as Record<string, unknown> | undefined
      const question = first?.question as string
      return question ? truncate(question, 80) : null
    }
    case 'Skill': {
      const args = getString(input, ['args'])
      return args ? truncate(args, 80) : null
    }
    default:
      return null
  }
}

// Status icon component
function StatusIcon({ state }: { state: 'completed' | 'error' | 'pending' | 'running' }) {
  if (state === 'completed') {
    return (
      <svg className="h-3 w-3 text-emerald-500" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.2 8.3l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (state === 'error') {
    return (
      <svg className="h-3 w-3 text-red-500" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (state === 'pending') {
    return (
      <svg className="h-3 w-3 text-amber-500" viewBox="0 0 16 16" fill="none">
        <rect x="4.5" y="7" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 7V5.8a2 2 0 0 1 4 0V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  // Running
  return (
    <svg className="h-3 w-3 text-claude-text-muted animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
    </svg>
  )
}

export function ToolCard({ tool }: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(false)

  const title = getToolTitle(tool)
  const subtitle = getToolSubtitle(tool)
  const icon = getToolIcon(tool.name)

  // Determine status
  const isCompleted = tool.result !== undefined
  const hasError = tool.isError
  const state: 'completed' | 'error' | 'pending' | 'running' = hasError
    ? 'error'
    : isCompleted
    ? 'completed'
    : 'running'

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="w-full text-left py-1.5 px-2 -mx-2 rounded-lg hover:bg-claude-surface/50 transition-colors group"
      >
        <div className="flex items-center gap-2">
          {/* Icon */}
          <span className="shrink-0 text-claude-text-dim">
            {icon}
          </span>

          {/* Title and subtitle */}
          <div className="min-w-0 flex-1 flex items-baseline gap-2">
            <span className="text-sm font-medium text-claude-text truncate">
              {tool.name}
            </span>
            {title !== tool.name && (
              <span className="text-sm text-claude-text-muted font-mono truncate">
                {title}
              </span>
            )}
            {subtitle && title === tool.name && (
              <span className="text-xs text-claude-text-dim font-mono truncate">
                {subtitle}
              </span>
            )}
          </div>

          {/* Status and chevron */}
          <div className="flex items-center gap-2 shrink-0">
            <StatusIcon state={state} />
            <span className="text-claude-text-dim opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        {/* Show subtitle on second line if title is different from tool name */}
        {subtitle && title !== tool.name && (
          <div className="mt-0.5 ml-5 text-xs text-claude-text-dim font-mono truncate">
            {subtitle}
          </div>
        )}
      </button>

      <ToolDetailSheet
        tool={tool}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  )
}
