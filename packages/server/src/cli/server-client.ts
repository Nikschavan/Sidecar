/**
 * Server Client
 *
 * Connects the CLI to the Sidecar WebSocket server.
 * Handles communication between CLI and phone via server.
 */

import WebSocket from 'ws'
import type { ServerMessage, ClientMessage } from '@sidecar/shared'

const SIDECAR_SERVER_URL = process.env.SIDECAR_SERVER_URL || 'ws://localhost:3456'

export interface ServerClientOptions {
  onRemoteMessage: (text: string) => void
}

export interface ServerClient {
  sendClaudeMessage: (message: unknown) => void
  setSessionId: (id: string) => void
  onMessage: (handler: (text: string) => void) => void
  onSwitchToRemote: (handler: () => void) => () => void
  close: () => void
}

export async function connectToServer(options: ServerClientOptions): Promise<ServerClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIDECAR_SERVER_URL)

    const messageHandlers: Array<(text: string) => void> = []
    const switchHandlers: Array<() => void> = []
    let sessionId: string | null = null
    let isCliClient = true // Mark this as CLI client

    ws.on('open', () => {
      console.log('[server-client] Connected to Sidecar server')

      // Register as CLI client
      ws.send(JSON.stringify({
        type: 'register_cli',
        timestamp: new Date().toISOString()
      }))

      const client: ServerClient = {
        sendClaudeMessage(message: unknown) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'claude_message',
              message,
              timestamp: new Date().toISOString()
            }))
          }
        },

        setSessionId(id: string) {
          sessionId = id
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'set_session',
              sessionId: id,
              timestamp: new Date().toISOString()
            }))
          }
        },

        onMessage(handler: (text: string) => void) {
          messageHandlers.push(handler)
        },

        onSwitchToRemote(handler: () => void) {
          switchHandlers.push(handler)
          return () => {
            const idx = switchHandlers.indexOf(handler)
            if (idx >= 0) switchHandlers.splice(idx, 1)
          }
        },

        close() {
          ws.close()
        }
      }

      resolve(client)
    })

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())

        // Handle message from phone (forwarded by server)
        if (message.type === 'phone_message') {
          const text = message.text as string
          options.onRemoteMessage(text)
          messageHandlers.forEach((h) => h(text))
        }

        // Handle switch to remote signal
        if (message.type === 'switch_to_remote') {
          switchHandlers.forEach((h) => h())
        }
      } catch (e) {
        console.error('[server-client] Invalid message:', e)
      }
    })

    ws.on('close', () => {
      console.log('[server-client] Disconnected from server')
    })

    ws.on('error', (err) => {
      console.error('[server-client] Connection error:', err.message)
      reject(err)
    })

    // Timeout after 5 seconds
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Connection timeout'))
      }
    }, 5000)
  })
}
