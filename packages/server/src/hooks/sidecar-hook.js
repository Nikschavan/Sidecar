#!/usr/bin/env node
/**
 * Claude Code Notification Hook for Sidecar
 *
 * This script receives notifications from Claude Code via stdin
 * and forwards them to the Sidecar server via HTTP POST.
 *
 * Configured in ~/.claude/settings.json as a notification hook.
 */

const http = require('http')
const net = require('net')

const port = process.env.SIDECAR_PORT || 7865
const host = process.env.SIDECAR_HOST || 'localhost'

// Early exit: Check if Sidecar is listening before processing
// This avoids unnecessary work if the hook wasn't cleaned up but Sidecar isn't running
const checkSocket = net.createConnection({ host, port, timeout: 100 }, () => {
  // Connection successful - Sidecar is running, proceed with hook
  checkSocket.destroy()
  processHook()
})

checkSocket.on('error', () => {
  // Sidecar not running - exit immediately without processing stdin
  process.exit(0)
})

checkSocket.on('timeout', () => {
  checkSocket.destroy()
  process.exit(0)
})

function processHook() {
  // Read hook input from stdin
  let data = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    data += chunk
  })

  process.stdin.on('end', () => {
    try {
      const hookData = JSON.parse(data)
      const postData = JSON.stringify(hookData)

      const options = {
        hostname: host,
        port: port,
        path: '/api/claude-hook',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        // Short timeout - localhost should respond quickly
        timeout: 1000
      }

      const req = http.request(options, (res) => {
        // Drain response
        res.on('data', () => {})
        res.on('end', () => {
          process.exit(0)
        })
      })

      req.on('error', (err) => {
        // Silently fail - don't block Claude if Sidecar isn't running
        console.error(`[sidecar-hook] Failed to send notification: ${err.message}`)
        process.exit(0)
      })

      req.on('timeout', () => {
        req.destroy()
        process.exit(0)
      })

      req.write(postData)
      req.end()
    } catch (err) {
      // Silently fail on parse errors
      console.error(`[sidecar-hook] Failed to parse hook data: ${err.message}`)
      process.exit(0)
    }
  })

  // Handle case where stdin is empty or closes immediately
  process.stdin.on('error', () => {
    process.exit(0)
  })
}
