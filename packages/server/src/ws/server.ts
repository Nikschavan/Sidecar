/**
 * WebSocket server
 *
 * Handles WebSocket connections and message routing
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { ServerMessage, ClientMessage } from '@sidecar/shared'

export interface WSServerOptions {
  onConnection: (client: WSClient) => void
  onMessage: (client: WSClient, message: ClientMessage) => void
  onClose: (client: WSClient) => void
}

export interface WSClient {
  id: string
  ws: WebSocket
  send: (message: ServerMessage) => void
}

let clientIdCounter = 0

export function createWSServer(wss: WebSocketServer, options: WSServerOptions) {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientId = `client-${++clientIdCounter}`

    const client: WSClient = {
      id: clientId,
      ws,
      send(message: ServerMessage) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message))
        }
      }
    }

    console.log(`[ws] Client connected: ${clientId}`)
    options.onConnection(client)

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage
        options.onMessage(client, message)
      } catch (e) {
        console.error(`[ws] Invalid message from ${clientId}:`, e)
        client.send({ type: 'error', error: 'Invalid message format' })
      }
    })

    ws.on('close', () => {
      console.log(`[ws] Client disconnected: ${clientId}`)
      options.onClose(client)
    })

    ws.on('error', (err) => {
      console.error(`[ws] Client error ${clientId}:`, err.message)
    })
  })

  return {
    broadcast(message: ServerMessage) {
      const data = JSON.stringify(message)
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data)
        }
      })
    },

    get clientCount() {
      return wss.clients.size
    }
  }
}
