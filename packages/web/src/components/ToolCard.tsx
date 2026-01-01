interface ToolCall {
  id: string
  name: string
  input: unknown
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

// Helper to get basename from path
function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

// Get tool presentation based on tool name and input
function getToolPresentation(tool: ToolCall): { title: string; subtitle: string | null; icon: string } {
  const { name, input } = tool

  switch (name) {
    case 'Read': {
      const file = getString(input, ['file_path', 'path', 'file'])
      return {
        icon: '📄',
        title: file ? basename(file) : 'Read file',
        subtitle: file || null
      }
    }

    case 'Edit': {
      const file = getString(input, ['file_path', 'path'])
      return {
        icon: '✏️',
        title: file ? basename(file) : 'Edit file',
        subtitle: file || null
      }
    }

    case 'Write': {
      const file = getString(input, ['file_path', 'path'])
      const content = getString(input, ['content'])
      const lines = content ? content.split('\n').length : 0
      return {
        icon: '📝',
        title: file ? basename(file) : 'Write file',
        subtitle: file ? `${file}${lines > 0 ? ` (${lines} lines)` : ''}` : null
      }
    }

    case 'Bash': {
      const command = getString(input, ['command', 'cmd'])
      const description = getString(input, ['description'])
      return {
        icon: '💻',
        title: description || 'Terminal',
        subtitle: command ? truncate(command, 60) : null
      }
    }

    case 'Glob': {
      const pattern = getString(input, ['pattern'])
      return {
        icon: '🔍',
        title: pattern ? `glob: ${pattern}` : 'Search files',
        subtitle: null
      }
    }

    case 'Grep': {
      const pattern = getString(input, ['pattern'])
      return {
        icon: '🔎',
        title: pattern ? `grep: ${truncate(pattern, 30)}` : 'Search content',
        subtitle: null
      }
    }

    case 'WebFetch': {
      const url = getString(input, ['url'])
      let host = 'Web fetch'
      if (url) {
        try {
          host = new URL(url).hostname
        } catch {
          host = truncate(url, 30)
        }
      }
      return {
        icon: '🌐',
        title: host,
        subtitle: url ? truncate(url, 50) : null
      }
    }

    case 'WebSearch': {
      const query = getString(input, ['query'])
      return {
        icon: '🔍',
        title: query ? truncate(query, 40) : 'Web search',
        subtitle: null
      }
    }

    case 'Task': {
      const description = getString(input, ['description'])
      const prompt = getString(input, ['prompt'])
      return {
        icon: '🚀',
        title: description || 'Task',
        subtitle: prompt ? truncate(prompt, 60) : null
      }
    }

    case 'TodoWrite': {
      const todos = (input as { todos?: unknown[] })?.todos
      const count = Array.isArray(todos) ? todos.length : 0
      return {
        icon: '📋',
        title: 'Todo list',
        subtitle: count > 0 ? `${count} items` : null
      }
    }

    case 'AskUserQuestion': {
      const questions = (input as { questions?: { question?: string; header?: string }[] })?.questions
      const first = questions?.[0]
      const header = first?.header || ''
      const question = first?.question || ''
      const count = questions?.length || 0
      return {
        icon: '❓',
        title: count > 1 ? `${count} Questions` : (header || 'Question'),
        subtitle: question ? truncate(question, 60) : null
      }
    }

    case 'NotebookEdit': {
      const path = getString(input, ['notebook_path'])
      const mode = getString(input, ['edit_mode'])
      return {
        icon: '📓',
        title: path ? basename(path) : 'Edit notebook',
        subtitle: mode ? `mode: ${mode}` : null
      }
    }

    case 'ExitPlanMode': {
      return {
        icon: '📝',
        title: 'Plan proposal',
        subtitle: null
      }
    }

    default: {
      // Check for MCP tools
      if (name.startsWith('mcp__')) {
        const parts = name.replace('mcp__', '').split('__')
        const serverName = parts[0] || 'MCP'
        const toolName = parts.slice(1).join(' ') || name
        return {
          icon: '🧩',
          title: `${serverName}: ${toolName}`,
          subtitle: null
        }
      }

      // Generic fallback
      const file = getString(input, ['file_path', 'path'])
      const command = getString(input, ['command'])
      const pattern = getString(input, ['pattern'])
      const subtitle = file || command || pattern
      return {
        icon: '⚡',
        title: name,
        subtitle: subtitle ? truncate(subtitle, 50) : null
      }
    }
  }
}

export function ToolCard({ tool }: ToolCardProps) {
  const { icon, title, subtitle } = getToolPresentation(tool)

  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-sm">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-300">
          {title}
        </div>
        {subtitle && (
          <div className="text-xs text-slate-500 truncate font-mono">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  )
}
