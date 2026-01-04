import { useCallback, useEffect, useState } from 'react'
import { getAuthHeaders } from '../utils/auth'

/**
 * Check if push notifications are supported
 */
function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * Convert base64url to Uint8Array (for VAPID public key)
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

export function usePushNotifications(apiUrl: string) {
  const [isSupported, setIsSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  /**
   * Refresh subscription status
   */
  const refreshSubscription = useCallback(async () => {
    if (!isPushSupported()) {
      setIsSupported(false)
      setIsSubscribed(false)
      return
    }

    setIsSupported(true)
    setPermission(Notification.permission)

    if (Notification.permission !== 'granted') {
      setIsSubscribed(false)
      return
    }

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      setIsSubscribed(Boolean(subscription))
    } catch (error) {
      console.error('[PushNotifications] Failed to check subscription:', error)
      setIsSubscribed(false)
    }
  }, [])

  useEffect(() => {
    void refreshSubscription()
  }, [refreshSubscription])

  /**
   * Request notification permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isPushSupported()) {
      return false
    }

    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        setIsSubscribed(false)
      }
      return result === 'granted'
    } catch (error) {
      console.error('[PushNotifications] Failed to request permission:', error)
      return false
    }
  }, [])

  /**
   * Subscribe to push notifications
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushSupported()) {
      return false
    }

    if (Notification.permission !== 'granted') {
      setPermission(Notification.permission)
      return false
    }

    setIsLoading(true)

    try {
      const registration = await navigator.serviceWorker.ready

      // Check for existing subscription
      const existing = await registration.pushManager.getSubscription()

      // Get VAPID public key from server
      const keyResponse = await fetch(`${apiUrl}/api/push/vapid-public-key`, {
        headers: getAuthHeaders()
      })
      if (!keyResponse.ok) {
        throw new Error(`Failed to get VAPID key: ${keyResponse.status}`)
      }
      const { publicKey } = await keyResponse.json()
      const applicationServerKey = base64UrlToUint8Array(publicKey).buffer as ArrayBuffer

      // Subscribe to push (or reuse existing)
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        }))

      // Send subscription to server
      const json = subscription.toJSON()
      const keys = json.keys
      if (!json.endpoint || !keys?.p256dh || !keys.auth) {
        throw new Error('Invalid subscription')
      }

      const subResponse = await fetch(`${apiUrl}/api/push/subscribe`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: keys.p256dh,
            auth: keys.auth
          }
        })
      })

      if (!subResponse.ok) {
        throw new Error(`Failed to register subscription: ${subResponse.status}`)
      }

      setIsSubscribed(true)
      return true
    } catch (error) {
      console.error('[PushNotifications] Failed to subscribe:', error)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [apiUrl])

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushSupported()) {
      return false
    }

    setIsLoading(true)

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        setIsSubscribed(false)
        return true
      }

      const endpoint = subscription.endpoint

      // Unsubscribe locally
      const success = await subscription.unsubscribe()

      // Remove from server
      await fetch(`${apiUrl}/api/push/subscribe`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ endpoint })
      })

      setIsSubscribed(false)
      return success
    } catch (error) {
      console.error('[PushNotifications] Failed to unsubscribe:', error)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [apiUrl])

  return {
    isSupported,
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
    permission,
    isSubscribed,
    isLoading,
    requestPermission,
    subscribe,
    unsubscribe
  }
}
