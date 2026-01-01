#!/usr/bin/env node
/**
 * Test script to simulate a phone client
 *
 * Usage:
 * 1. Terminal 1: pnpm --filter @sidecar/server start
 * 2. Terminal 2: cd packages/server && npx tsx src/cli.ts
 * 3. Terminal 3: cd packages/server && npx tsx src/test-phone.ts "Your message"
 *
 * Or with node directly:
 *   node --loader ts-node/esm packages/server/src/test-phone.ts "message"
 */

import WebSocket from 'ws'

const WS_URL = 'ws://localhost:3456'

async function main() {
  const message = process.argv[2] || 'Hello from phone! What is 2+2?'

  console.log('Connecting to Sidecar server...')
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

main().catch(console.error)
