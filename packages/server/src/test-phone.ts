#!/usr/bin/env node
/**
 * Test script to simulate a phone client
 *
 * Usage:
 *   # WebSocket mode (takes over sidecar CLI):
 *   pnpm test:phone "Your message"
 *
 *   # API mode (resumes any Claude session):
 *   pnpm test:phone --session-id <id> "Your message"
 *   pnpm test:phone -s <id> "Your message"
 *   pnpm test:phone --latest "Your message"  # Use most recent session
 */

import WebSocket from 'ws'

const API_URL = 'http://localhost:3456'
const WS_URL = 'ws://localhost:3456'

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2)
  let sessionId: string | null = null
  let useLatest = false
  let message = 'Hello from phone! What is 2+2?'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-id' || args[i] === '-s') {
      sessionId = args[i + 1]
      i++
    } else if (args[i] === '--latest' || args[i] === '-l') {
      useLatest = true
    } else if (!args[i].startsWith('-')) {
      message = args[i]
    }
  }

  return { sessionId, useLatest, message }
}

// API mode: send via HTTP POST (resumes session)
async function sendViaAPI(sessionId: string | null, message: string) {
  const endpoint = sessionId
    ? `${API_URL}/api/claude/sessions/${sessionId}/send`
    : `${API_URL}/api/claude/send`

  console.log(`Sending via API to ${sessionId || 'most recent session'}...`)
  console.log(`Message: "${message}"`)
  console.log(`Endpoint: ${endpoint}\n`)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message })
  })

  const data = await response.json()

  if (!response.ok) {
    console.error('Error:', data.error || 'Unknown error')
    process.exit(1)
  }

  console.log(`Session: ${data.sessionId}`)
  console.log(`Responses: ${data.messageCount}\n`)

  // Print Claude's response
  for (const msg of data.responses || []) {
    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            console.log('Claude:', block.text)
          }
        }
      }
    }
  }
}

// WebSocket mode: take over sidecar CLI
async function sendViaWebSocket(message: string) {
  console.log('Connecting to Sidecar server (WebSocket mode)...')
  console.log(`Will send message: "${message}"`)

  const ws = new WebSocket(WS_URL)

  ws.on('open', () => {
    console.log('\nConnected! Registering as phone...')

    // Register as phone
    ws.send(JSON.stringify({
      type: 'register_phone',
      timestamp: new Date().toISOString()
    }))

    // Wait a bit then take over
    setTimeout(() => {
      console.log('\nSending take_over to switch CLI to remote mode...')
      ws.send(JSON.stringify({
        type: 'take_over',
        timestamp: new Date().toISOString()
      }))
    }, 1000)

    // Wait for CLI to switch, then send message
    setTimeout(() => {
      console.log(`\nSending message to Claude: "${message}"`)
      ws.send(JSON.stringify({
        type: 'phone_send',
        text: message,
        timestamp: new Date().toISOString()
      }))
    }, 3000)
  })

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      console.log('\n📱 Received:', msg.type)

      if (msg.type === 'session_update') {
        console.log('   Session ID:', msg.sessionId)
      }

      if (msg.type === 'claude_message') {
        // Pretty print Claude's response
        const content = msg.message?.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              console.log('   Claude says:', block.text.slice(0, 200))
            }
          }
        }
      }
    } catch (e) {
      console.log('Raw message:', data.toString().slice(0, 200))
    }
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message)
  })

  ws.on('close', () => {
    console.log('\nDisconnected from server')
    process.exit(0)
  })

  // Keep running for 30 seconds to receive Claude's response
  setTimeout(() => {
    console.log('\nTest complete, closing connection...')
    ws.close()
  }, 30000)
}

// Main entry point
async function main() {
  const { sessionId, useLatest, message } = parseArgs()

  // If --session-id or --latest provided, use API mode
  if (sessionId || useLatest) {
    await sendViaAPI(sessionId, message)
  } else {
    // Otherwise use WebSocket mode (takes over sidecar CLI)
    await sendViaWebSocket(message)
  }
}

main().catch(console.error)
