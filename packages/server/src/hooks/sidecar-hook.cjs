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

const port = process.env.SIDECAR_PORT || 7865
const host = process.env.SIDECAR_HOST || 'localhost'

// Read stdin immediately (don't wait for connection check)
let data = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  data += chunk
})

process.stdin.on('end', () => {
  if (!data) {
    process.exit(0)
  }

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
      timeout: 500
    }

    const req = http.request(options, (res) => {
      // Drain response and exit
      res.on('data', () => {})
      res.on('end', () => process.exit(0))
    })

    req.on('error', () => {
      // Silently fail - don't block Claude if Sidecar isn't running
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
    process.exit(0)
  }
})

process.stdin.on('error', () => {
  process.exit(0)
})
