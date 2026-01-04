import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from './lib/queryClient'
import App from './App'
import './index.css'

const queryClient = createQueryClient()

// Register service worker for PWA and push notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[SW] Registered:', registration.scope)

        // Check for updates immediately and periodically
        registration.update()
        setInterval(() => {
          registration.update()
        }, 60 * 1000) // Check every minute

        // When a new service worker is found
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (!newWorker) return

          newWorker.addEventListener('statechange', () => {
            // New SW is active and there's an existing controller (not first install)
            if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
              console.log('[SW] New version activated, reloading...')
              window.location.reload()
            }
          })
        })
      })
      .catch((error) => {
        console.error('[SW] Registration failed:', error)
      })
  })

  // Reload when the controlling service worker changes
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    console.log('[SW] Controller changed, reloading...')
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
