/**
 * Push Notification Service
 *
 * Sends Web Push notifications to subscribed clients
 */

import webPush from 'web-push'
import type { VapidKeys } from './vapidKeys.js'
import {
  listSubscriptions,
  removeSubscription,
  type StoredSubscription
} from './subscriptionStore.js'

export interface PushPayload {
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

export class PushService {
  private initialized = false

  constructor(
    private readonly vapidKeys: VapidKeys,
    // Apple's push service requires a valid email domain or HTTPS URL
    // Using env var allows customization, defaults to a valid format
    private readonly subject: string = process.env.VAPID_SUBJECT || 'mailto:webpush@example.com'
  ) {
    this.initialize()
  }

  private initialize(): void {
    if (this.initialized) return

    webPush.setVapidDetails(this.subject, this.vapidKeys.publicKey, this.vapidKeys.privateKey)

    this.initialized = true
  }

  /**
   * Send a push notification to all subscribed clients
   */
  async sendToAll(payload: PushPayload): Promise<void> {
    const subscriptions = listSubscriptions()
    if (subscriptions.length === 0) {
      return
    }

    const body = JSON.stringify(payload)
    const results = await Promise.allSettled(
      subscriptions.map((subscription) => this.sendToSubscription(subscription, body))
    )

    // Log any failures
    const failures = results.filter((r) => r.status === 'rejected')
    if (failures.length > 0) {
      console.log(`[PushService] ${failures.length}/${subscriptions.length} notifications failed`)
    }
  }

  /**
   * Send a push notification to a single subscription
   */
  private async sendToSubscription(
    subscription: StoredSubscription,
    body: string
  ): Promise<void> {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    }

    try {
      await webPush.sendNotification(pushSubscription, body)
    } catch (error) {
      const statusCode =
        typeof (error as { statusCode?: unknown }).statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : null

      // 410 Gone means the subscription is no longer valid
      if (statusCode === 410) {
        console.log(`[PushService] Removing stale subscription: ${subscription.endpoint}`)
        removeSubscription(subscription.endpoint)
        return
      }

      // 404 also means subscription is invalid
      if (statusCode === 404) {
        console.log(`[PushService] Removing invalid subscription: ${subscription.endpoint}`)
        removeSubscription(subscription.endpoint)
        return
      }

      console.error('[PushService] Failed to send notification:', error)
      throw error
    }
  }

  /**
   * Get the public VAPID key (for client-side subscription)
   */
  getPublicKey(): string {
    return this.vapidKeys.publicKey
  }
}
