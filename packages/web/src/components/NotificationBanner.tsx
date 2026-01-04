import { useState, useEffect } from 'react'
import { usePushNotifications } from '../hooks/usePushNotifications'

const DISMISSED_KEY = 'sidecar-notification-banner-dismissed'

interface NotificationBannerProps {
  apiUrl: string
}

export function NotificationBanner({ apiUrl }: NotificationBannerProps) {
  const {
    isSupported,
    isSecureContext,
    permission,
    isSubscribed,
    isLoading,
    requestPermission,
    subscribe
  } = usePushNotifications(apiUrl)

  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISSED_KEY) === 'true'
  })

  // Auto-subscribe if permission was already granted
  useEffect(() => {
    if (permission === 'granted' && !isSubscribed && !isLoading) {
      subscribe()
    }
  }, [permission, isSubscribed, isLoading, subscribe])

  // Don't show if:
  // - Not supported
  // - Not secure context (HTTPS required)
  // - Already subscribed
  // - Permission denied
  // - User dismissed
  if (
    !isSupported ||
    !isSecureContext ||
    isSubscribed ||
    permission === 'denied' ||
    dismissed
  ) {
    return null
  }

  const handleEnable = async () => {
    const granted = await requestPermission()
    if (granted) {
      await subscribe()
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem(DISMISSED_KEY, 'true')
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 px-4 py-3 flex items-center justify-between gap-3"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
    >
      <div className="flex items-center gap-2 text-sm text-slate-200">
        <svg
          className="w-5 h-5 flex-shrink-0 text-amber-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        <span>Get notified when Claude needs approval</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleEnable}
          disabled={isLoading}
          className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Enabling...' : 'Enable'}
        </button>
        <button
          onClick={handleDismiss}
          className="text-slate-400 hover:text-slate-200 px-2 py-1 text-sm transition-colors"
        >
          Later
        </button>
      </div>
    </div>
  )
}
