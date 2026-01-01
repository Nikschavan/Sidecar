/**
 * Test script for Claude spawning
 */

import { spawnClaude } from './claude/spawn.js'

async function main() {
  console.log('[test] Starting Claude spawn test...\n')

  const claude = spawnClaude({
    cwd: process.cwd(),
    onMessage(msg) {
      if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
        console.log(`[system] Session: ${(msg as { session_id: string }).session_id}`)
      } else if (msg.type === 'assistant') {
        const content = (msg as { message: { content: Array<{ type: string; text?: string }> } }).message.content
        for (const c of content) {
          if (c.type === 'text' && c.text) {
            console.log(`[claude] ${c.text}`)
          }
        }
      } else if (msg.type === 'result') {
        const result = msg as { duration_ms: number; is_error: boolean }
        console.log(`[result] Done in ${result.duration_ms}ms (error: ${result.is_error})`)
      }
    },
    onSessionId(id) {
      console.log(`[test] Session ID captured: ${id}`)
    },
    onExit(code) {
      console.log(`\n[test] Claude exited with code ${code}`)
      if (claude.sessionId) {
        console.log(`[test] To resume: claude --resume ${claude.sessionId}`)
      }
    }
  })

  // Send test message
  console.log('[test] Sending: Say "Hello from Sidecar!" and nothing else.\n')
  claude.send('Say "Hello from Sidecar!" and nothing else.')

  // End input after single message
  claude.child.stdin.end()
}

main().catch(console.error)
