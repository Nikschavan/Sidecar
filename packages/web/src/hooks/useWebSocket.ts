import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage } from '@sidecar/shared'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

interface SessionUpdate {
  sessionId: string
}

interface UseWebSocketOptions {
  url: string
  onMessage?: (messages: ChatMessage[]) => void
  onSessionUpdate?: (session: SessionUpdate) => void
}

export function useWebSocket({ url, onMessage, onSessionUpdate }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [currentSession, setCurrentSession] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      // Register as phone client
      ws.send(JSON.stringify({
        type: 'register_phone',
        timestamp: new Date().toISOString()
      }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        
        if (msg.type === 'session_update') {
          setCurrentSession(msg.sessionId)
          onSessionUpdate?.(msg)
        }
        
        if (msg.type === 'claude_message') {
          // Handle streaming message from Claude
          onMessage?.([msg.message])
        }

        if (msg.type === 'history') {
          onMessage?.(msg.messages || [])
        }
      } catch (e) {
        console.error('Failed to parse message:', e)
      }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      // Auto-reconnect after 2 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, 2000)
    }

    ws.onerror = () => {
      setStatus('error')
    }
  }, [url, onMessage, onSessionUpdate])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    wsRef.current?.close()
    wsRef.current = null
    setStatus('disconnected')
  }, [])

  const send = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'phone_send',
        text,
        timestamp: new Date().toISOString()
      }))
    }
  }, [])

  const takeOver = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'take_over',
        timestamp: new Date().toISOString()
      }))
    }
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return {
    status,
    currentSession,
    send,
    takeOver,
    connect,
    disconnect
  }
}
