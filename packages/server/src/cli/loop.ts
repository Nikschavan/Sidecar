/**
 * Main control loop
 *
 * Manages switching between local (interactive) and remote (phone) modes.
 */

import { runLocalMode } from './local.js'
import { runRemoteMode } from './remote.js'
import { connectToServer } from './server-client.js'

export type Mode = 'local' | 'remote'
export type SwitchReason = 'exit' | 'switch_to_remote' | 'switch_to_local'

export interface LoopOptions {
  cwd: string
  args: string[]
}

export async function runLoop(options: LoopOptions): Promise<void> {
  let claudeSessionId: string | null = null
  let mode: Mode = 'local'

  // Connect to Sidecar server
  const server = await connectToServer({
    onRemoteMessage: () => {
      // Phone sent a message - will be handled in remote mode
    }
  })

  console.log(`[sidecar] Connected to server`)
  console.log(`[sidecar] Starting in LOCAL mode\n`)

  while (true) {
    if (mode === 'local') {
      const result = await runLocalMode({
        cwd: options.cwd,
        args: options.args,
        resumeSessionId: claudeSessionId,
        server,
        onSessionId: (id) => {
          claudeSessionId = id
        }
      })

      if (result.reason === 'exit') {
        console.log('\n[sidecar] Claude exited, goodbye!')
        process.exit(0)
      }

      if (result.reason === 'switch_to_remote') {
        console.log('\n[sidecar] Switching to REMOTE mode...')
        mode = 'remote'
        continue
      }
    }

    if (mode === 'remote') {
      const result = await runRemoteMode({
        cwd: options.cwd,
        resumeSessionId: claudeSessionId,
        server,
        onSessionId: (id) => {
          claudeSessionId = id
        }
      })

      if (result.reason === 'exit') {
        console.log('\n[sidecar] Claude exited, goodbye!')
        process.exit(0)
      }

      if (result.reason === 'switch_to_local') {
        console.log('\n[sidecar] Switching to LOCAL mode...')
        mode = 'local'
        continue
      }
    }
  }
}
