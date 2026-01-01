/**
 * Local Mode
 *
 * Runs Claude interactively in a PTY. User types directly.
 * Switches to remote mode when server signals phone took over.
 */

import * as pty from 'node-pty'
import type { SwitchReason } from './loop.js'
import type { ServerClient } from './server-client.js'

export interface LocalModeOptions {
  cwd: string
  args: string[]
  resumeSessionId: string | null
  server: ServerClient
  onSessionId: (id: string) => void
}

export interface LocalModeResult {
  reason: SwitchReason
}

export async function runLocalMode(options: LocalModeOptions): Promise<LocalModeResult> {
  return new Promise((resolve, reject) => {
    // Check if we have a proper TTY
    if (!process.stdin.isTTY) {
      console.error('[local] Error: stdin is not a TTY. Run this command directly in a terminal, not through pnpm.')
      console.error('[local] Try: cd packages/server && npx tsx src/cli.ts')
      reject(new Error('stdin is not a TTY'))
      return
    }

    // Build Claude args
    const args: string[] = [...options.args]

    if (options.resumeSessionId) {
      // Check if --resume or --continue already in args
      if (!args.includes('--resume') && !args.includes('--continue')) {
        args.push('--resume', options.resumeSessionId)
      }
    }

    console.log(`[local] Spawning: claude ${args.join(' ')}`)

    let ptyProcess: pty.IPty
    try {
      // Spawn Claude in PTY
      ptyProcess = pty.spawn('claude', args, {
        name: 'xterm-256color',
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
        cwd: options.cwd,
        env: {
          ...process.env,
          DISABLE_AUTOUPDATER: '1'
        }
      })
    } catch (err) {
      console.error('[local] Error spawning PTY:', err)
      reject(err)
      return
    }

    // Pipe PTY output to stdout
    ptyProcess.onData((data) => {
      process.stdout.write(data)

      // Try to detect session ID from output
      // Claude prints session info, we can parse it
      // For now, we'll rely on the session file watcher
    })

    // Pipe stdin to PTY
    process.stdin.setRawMode(true)
    process.stdin.resume()

    const stdinHandler = (data: Buffer) => {
      ptyProcess.write(data.toString())
    }
    process.stdin.on('data', stdinHandler)

    // Handle resize
    const resizeHandler = () => {
      ptyProcess.resize(
        process.stdout.columns || 80,
        process.stdout.rows || 24
      )
    }
    process.stdout.on('resize', resizeHandler)

    // Listen for switch to remote signal from server
    const unsubscribe = options.server.onSwitchToRemote(() => {
      console.log('\n[local] Phone took over, killing local Claude...')
      cleanup()
      ptyProcess.kill()
      resolve({ reason: 'switch_to_remote' })
    })

    // Cleanup function
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.removeListener('data', stdinHandler)
      process.stdout.removeListener('resize', resizeHandler)
      unsubscribe()
    }

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`\n[local] Claude exited with code ${exitCode}`)
      cleanup()
      resolve({ reason: 'exit' })
    })
  })
}
