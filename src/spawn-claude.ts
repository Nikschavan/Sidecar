/**
 * spawn-claude.ts
 *
 * Minimal proof-of-concept to spawn Claude Code in JSON streaming mode
 * and interact with it programmatically.
 *
 * Usage: pnpm test
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

// Types for Claude's JSON streaming output
interface ClaudeMessage {
  type: string
  [key: string]: unknown
}

interface SystemInitMessage extends ClaudeMessage {
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  tools: string[]
}

interface AssistantMessage extends ClaudeMessage {
  type: 'assistant'
  message: {
    role: 'assistant'
    content: Array<{ type: string; text?: string; thinking?: string }>
  }
}

interface ResultMessage extends ClaudeMessage {
  type: 'result'
  result: string
  duration_ms: number
  is_error: boolean
}

// Format message for logging
function formatMessage(msg: ClaudeMessage): string {
  switch (msg.type) {
    case 'system':
      if ((msg as SystemInitMessage).subtype === 'init') {
        const init = msg as SystemInitMessage
        return `[SYSTEM] Session started: ${init.session_id}`
      }
      return `[SYSTEM] ${JSON.stringify(msg)}`

    case 'assistant': {
      const assistant = msg as AssistantMessage
      const content = assistant.message?.content || []
      const texts = content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text)
        .join('\n')
      return texts ? `[CLAUDE] ${texts}` : ''
    }

    case 'result': {
      const result = msg as ResultMessage
      return `[RESULT] Completed in ${result.duration_ms}ms (error: ${result.is_error})`
    }

    default:
      return `[${msg.type.toUpperCase()}] ${JSON.stringify(msg).slice(0, 100)}...`
  }
}

// Spawn Claude in JSON streaming mode
function spawnClaude(cwd: string): ChildProcessWithoutNullStreams {
  const args = [
    '--print',                      // Non-interactive mode
    '--output-format', 'stream-json', // JSON output
    '--input-format', 'stream-json',  // JSON input (for multi-turn)
    '--verbose'                     // More detailed output
  ]

  console.log(`\n[SIDECAR] Spawning: claude ${args.join(' ')}`)
  console.log(`[SIDECAR] Working directory: ${cwd}\n`)

  const child = spawn('claude', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DISABLE_AUTOUPDATER: '1'
    }
  })

  return child
}

// Main function
async function main() {
  const cwd = process.cwd()
  const child = spawnClaude(cwd)

  // Track session ID for later resume
  let sessionId: string | null = null

  // Read stdout line by line (each line is a JSON message)
  const rl = createInterface({ input: child.stdout })

  rl.on('line', (line) => {
    if (!line.trim()) return

    try {
      const msg = JSON.parse(line) as ClaudeMessage

      // Capture session ID
      if (msg.type === 'system' && (msg as SystemInitMessage).subtype === 'init') {
        sessionId = (msg as SystemInitMessage).session_id
      }

      const formatted = formatMessage(msg)
      if (formatted) {
        console.log(formatted)
      }
    } catch (e) {
      // Non-JSON output (shouldn't happen in stream-json mode)
      console.log(`[RAW] ${line}`)
    }
  })

  // Handle stderr (errors, debug info)
  child.stderr.on('data', (data: Buffer) => {
    console.error(`[STDERR] ${data.toString().trim()}`)
  })

  // Handle process exit
  child.on('close', (code) => {
    console.log(`\n[SIDECAR] Claude exited with code ${code}`)
    if (sessionId) {
      console.log(`[SIDECAR] Session ID: ${sessionId}`)
      console.log(`[SIDECAR] To resume: claude --resume ${sessionId}`)
    }
    process.exit(code || 0)
  })

  child.on('error', (err) => {
    console.error(`[SIDECAR] Failed to spawn Claude: ${err.message}`)
    process.exit(1)
  })

  // Send initial message
  const initialMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: 'Say "Hello from Sidecar!" and nothing else.'
    }
  }

  console.log(`[SIDECAR] Sending: ${initialMessage.message.content}\n`)
  child.stdin.write(JSON.stringify(initialMessage) + '\n')

  // End input after sending (single-turn for now)
  // For multi-turn, we'd keep stdin open and send more messages
  child.stdin.end()
}

main().catch(console.error)
