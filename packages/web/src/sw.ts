/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// Precache manifest (injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST)

// Skip waiting to activate new service worker immediately
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Push notification payload type
interface PushPayload {
  title: string
  body?: string
  icon?: string
  badge?: string
  tag?: string
  data?: {
    type?: string
    sessionId?: string
    url?: string
  }
}

// Handle push notifications
self.addEventListener('push', (event) => {
  const payload = event.data?.json() as PushPayload | undefined
  if (!payload) {
    return
  }

  const title = payload.title || 'Sidecar'
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: payload.icon ?? '/pwa-192x192.png',
    badge: payload.badge ?? '/pwa-192x192.png',
    data: payload.data,
    tag: payload.tag,
    requireInteraction: true
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data as { url?: string } | undefined
  const url = data?.url ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus().then((focusedClient) => {
            // Navigate to the URL if the client supports it
            if ('navigate' in focusedClient) {
              return (focusedClient as WindowClient).navigate(url)
            }
          })
        }
      }
      // No existing window, open a new one
      return self.clients.openWindow(url)
    })
  )
})

// Handle service worker activation
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
