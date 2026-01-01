/**
 * Claude process spawning and management
 *
 * Spawns Claude Code in JSON streaming mode and handles
 * bidirectional communication via stdin/stdout.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ClaudeMessage } from '@sidecar/shared'

/**
 * Permission request from Claude (control_request message)
 */
export interface PermissionRequest {
  requestId: string
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  permissionSuggestions?: Array<{
    type: string
    mode?: string
    destination?: string
  }>
}

export interface ClaudeProcess {
  child: ChildProcessWithoutNullStreams
  sessionId: string | null
  send: (text: string) => void
  sendPermissionResponse: (requestId: string, allow: boolean, updatedInput?: Record<string, unknown>) => void
  onMessage: (callback: (msg: ClaudeMessage) => void) => void
  onPermissionRequest: (callback: (req: PermissionRequest) => void) => void
  onExit: (callback: (code: number | null) => void) => void
}

export interface SpawnOptions {
  cwd: string
  resume?: string
  onMessage?: (msg: ClaudeMessage) => void
  onSessionId?: (id: string) => void
  onPermissionRequest?: (req: PermissionRequest) => void
  onExit?: (code: number | null) => void
}

/**
 * Spawn Claude in JSON streaming mode with permission handling
 */
export function spawnClaude(options: SpawnOptions): ClaudeProcess {
  const args = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--permission-prompt-tool', 'stdio',
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
  const permissionCallbacks: Array<(req: PermissionRequest) => void> = []
  const exitCallbacks: Array<(code: number | null) => void> = []

  if (options.onMessage) {
    messageCallbacks.push(options.onMessage)
  }

  if (options.onPermissionRequest) {
    permissionCallbacks.push(options.onPermissionRequest)
  }

  if (options.onExit) {
    exitCallbacks.push(options.onExit)
  }

  // Parse stdout line by line
  const rl = createInterface({ input: child.stdout })

  rl.on('line', (line) => {
    if (!line.trim()) return

    try {
      const msg = JSON.parse(line)

      // Handle control_request (permission request)
      if (msg.type === 'control_request') {
        const permReq: PermissionRequest = {
          requestId: msg.request_id,
          toolName: msg.request.tool_name,
          toolUseId: msg.request.tool_use_id,
          input: msg.request.input,
          permissionSuggestions: msg.request.permission_suggestions
        }
        for (const cb of permissionCallbacks) {
          cb(permReq)
        }
        return
      }

      // Capture session ID
      if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
        sessionId = (msg as { session_id: string }).session_id
        if (options.onSessionId) {
          options.onSessionId(sessionId)
        }
      }

      for (const cb of messageCallbacks) {
        cb(msg as ClaudeMessage)
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
    sendPermissionResponse(requestId: string, allow: boolean, updatedInput?: Record<string, unknown>) {
      if (allow) {
        // Send approval with control_response format
        const msg = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: {
              behavior: 'allow',
              updatedInput: updatedInput || {}
            }
          }
        }
        child.stdin.write(JSON.stringify(msg) + '\n')
      } else {
        // Send denial
        const msg = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            response: {
              behavior: 'deny',
              message: 'User denied permission'
            }
          }
        }
        child.stdin.write(JSON.stringify(msg) + '\n')
      }
    },
    onMessage(callback) {
      messageCallbacks.push(callback)
    },
    onPermissionRequest(callback) {
      permissionCallbacks.push(callback)
    },
    onExit(callback) {
      exitCallbacks.push(callback)
    }
  }
}
