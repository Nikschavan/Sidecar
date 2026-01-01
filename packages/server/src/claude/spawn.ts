/**
 * Claude process spawning and management
 *
 * Spawns Claude Code in JSON streaming mode and handles
 * bidirectional communication via stdin/stdout.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ClaudeMessage } from '@sidecar/shared'

export interface ClaudeProcess {
  child: ChildProcessWithoutNullStreams
  sessionId: string | null
  send: (text: string) => void
  onMessage: (callback: (msg: ClaudeMessage) => void) => void
  onExit: (callback: (code: number | null) => void) => void
}

export interface SpawnOptions {
  cwd: string
  resume?: string
  onMessage?: (msg: ClaudeMessage) => void
  onSessionId?: (id: string) => void
  onExit?: (code: number | null) => void
}

/**
 * Spawn Claude in JSON streaming mode
 */
export function spawnClaude(options: SpawnOptions): ClaudeProcess {
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose'
  ]

  if (options.resume) {
    args.push('--resume', options.resume)
  }

  const child = spawn('claude', args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DISABLE_AUTOUPDATER: '1'
    }
  })

  let sessionId: string | null = null
  const messageCallbacks: Array<(msg: ClaudeMessage) => void> = []
  const exitCallbacks: Array<(code: number | null) => void> = []

  if (options.onMessage) {
    messageCallbacks.push(options.onMessage)
  }

  if (options.onExit) {
    exitCallbacks.push(options.onExit)
  }

  // Parse stdout line by line
  const rl = createInterface({ input: child.stdout })

  rl.on('line', (line) => {
    if (!line.trim()) return

    try {
      const msg = JSON.parse(line) as ClaudeMessage

      // Capture session ID
      if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
        sessionId = (msg as { session_id: string }).session_id
        if (options.onSessionId) {
          options.onSessionId(sessionId)
        }
      }

      for (const cb of messageCallbacks) {
        cb(msg)
      }
    } catch {
      // Non-JSON output, ignore
    }
  })

  // Handle stderr
  child.stderr.on('data', (data: Buffer) => {
    console.error(`[claude stderr] ${data.toString().trim()}`)
  })

  // Handle exit
  child.on('close', (code) => {
    for (const cb of exitCallbacks) {
      cb(code)
    }
  })

  return {
    child,
    get sessionId() {
      return sessionId
    },
    send(text: string) {
      const msg = {
        type: 'user',
        message: {
          role: 'user',
          content: text
        }
      }
      child.stdin.write(JSON.stringify(msg) + '\n')
    },
    onMessage(callback) {
      messageCallbacks.push(callback)
    },
    onExit(callback) {
      exitCallbacks.push(callback)
    }
  }
}
