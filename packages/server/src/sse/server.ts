/**
 * SSE Server
 *
 * Manages SSE client connections and event broadcasting
 */

export type SSEEventType =
  | 'connected'
  | 'claude_message'
  | 'permission_request'
  | 'permission_resolved'
  | 'permission_timeout'
  | 'state_change'
  | 'session_aborted'
  | 'message'
  | 'heartbeat'

export interface SSEClient {
  id: string
  sessionId: string
  send: (event: SSEEventType, data: unknown) => void
}

/**
 * SSE Server that manages client connections and broadcasts events
 */
export class SSEServer {
  private clients = new Map<string, SSEClient>()
  private sessionClients = new Map<string, Set<string>>() // sessionId -> clientIds

  /**
   * Add a client connection
   */
  addClient(
    sessionId: string,
    clientId: string,
    sendFn: (event: SSEEventType, data: unknown) => void
  ): SSEClient {
    const client: SSEClient = {
      id: clientId,
      sessionId,
      send: sendFn,
    }

    this.clients.set(clientId, client)

    // Track client by session
    if (!this.sessionClients.has(sessionId)) {
      this.sessionClients.set(sessionId, new Set())
    }
    this.sessionClients.get(sessionId)!.add(clientId)

    console.log(`[sse] Client connected: ${clientId} watching session ${sessionId}`)
    return client
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) return

    // Remove from session tracking
    const sessionClients = this.sessionClients.get(client.sessionId)
    if (sessionClients) {
      sessionClients.delete(clientId)
      if (sessionClients.size === 0) {
        this.sessionClients.delete(client.sessionId)
      }
    }

    this.clients.delete(clientId)
    console.log(`[sse] Client disconnected: ${clientId}`)
  }

  /**
   * Send an event to all clients watching a specific session
   */
  sendToSession(sessionId: string, event: SSEEventType, data: unknown): void {
    const clientIds = this.sessionClients.get(sessionId)
    if (!clientIds || clientIds.size === 0) return

    for (const clientId of clientIds) {
      const client = this.clients.get(clientId)
      if (client) {
        try {
          client.send(event, data)
        } catch (err) {
          console.error(`[sse] Failed to send to client ${clientId}:`, err)
        }
      }
    }
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: SSEEventType, data: unknown): void {
    for (const client of this.clients.values()) {
      try {
        client.send(event, data)
      } catch (err) {
        console.error(`[sse] Failed to broadcast to client ${client.id}:`, err)
      }
    }
  }

  /**
   * Get the number of connected clients
   */
  get clientCount(): number {
    return this.clients.size
  }

  /**
   * Get the number of clients watching a specific session
   */
  getSessionClientCount(sessionId: string): number {
    return this.sessionClients.get(sessionId)?.size ?? 0
  }
}

// Global SSE server instance
export const sseServer = new SSEServer()
