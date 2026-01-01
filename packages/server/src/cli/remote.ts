/**
 * Remote Mode
 *
 * Runs Claude in JSON streaming mode, controlled from phone.
 * Switches to local mode when user presses any key.
 */

import { spawnClaude, type ClaudeProcess } from '../claude/spawn.js'
import type { SwitchReason } from './loop.js'
import type { ServerClient } from './server-client.js'

export interface RemoteModeOptions {
  cwd: string
  resumeSessionId: string | null
  server: ServerClient
  onSessionId: (id: string) => void
}

export interface RemoteModeResult {
  reason: SwitchReason
}

export async function runRemoteMode(options: RemoteModeOptions): Promise<RemoteModeResult> {
  return new Promise((resolve) => {
    let claude: ClaudeProcess | null = null
    let resolved = false

    const cleanup = () => {
      if (resolved) return
      resolved = true
      process.stdin.setRawMode(false)
      process.stdin.removeListener('data', stdinHandler)
      if (claude) {
        claude.child.kill()
      }
    }

    // Show remote mode indicator
    console.log('\n[remote] Waiting for messages from phone...')
    console.log('[remote] Press any key to switch back to local mode\n')

    // Listen for keyboard to switch back to local
    process.stdin.setRawMode(true)
    process.stdin.resume()

    const stdinHandler = (data: Buffer) => {
      // Any key press switches back to local
      console.log('\n[remote] Key pressed, switching to local...')
      cleanup()
      resolve({ reason: 'switch_to_local' })
    }
    process.stdin.on('data', stdinHandler)

    // Start Claude when first message arrives from phone
    const startClaude = (message: string) => {
      if (claude) {
        // Already running, just send message
        claude.send(message)
        return
      }

      console.log(`[remote] Starting Claude with message: ${message.slice(0, 50)}...`)

      claude = spawnClaude({
        cwd: options.cwd,
        resume: options.resumeSessionId || undefined,
        onMessage: (msg) => {
          // Forward to server for phone
          options.server.sendClaudeMessage(msg)

          // Also show locally
          if (msg.type === 'assistant') {
            const assistant = msg as {
              message: { content: Array<{ type: string; text?: string }> }
            }
            for (const content of assistant.message.content) {
              if (content.type === 'text' && content.text) {
                console.log(`[claude] ${content.text}`)
              }
            }
          }
        },
        onSessionId: (id) => {
          options.onSessionId(id)
          options.server.setSessionId(id)
        },
        onExit: (code) => {
          console.log(`[remote] Claude exited with code ${code}`)
          cleanup()
          resolve({ reason: 'exit' })
        }
      })

      // Send the initial message
      claude.send(message)
    }

    // Listen for messages from phone via server
    options.server.onMessage((text) => {
      console.log(`[remote] Received from phone: ${text.slice(0, 50)}...`)
      startClaude(text)
    })
  })
}
