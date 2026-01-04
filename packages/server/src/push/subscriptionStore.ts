/**
 * Push Subscription Store
 *
 * Manages push notification subscriptions in a JSON file
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SIDECAR_DIR = join(homedir(), '.sidecar')
const SUBSCRIPTIONS_FILE = join(SIDECAR_DIR, 'push-subscriptions.json')

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
  createdAt: string
}

interface SubscriptionsData {
  subscriptions: StoredSubscription[]
}

/**
 * Ensure the .sidecar directory exists
 */
function ensureDir(): void {
  if (!existsSync(SIDECAR_DIR)) {
    mkdirSync(SIDECAR_DIR, { recursive: true })
  }
}

/**
 * Load subscriptions from file
 */
function loadSubscriptions(): SubscriptionsData {
  try {
    if (!existsSync(SUBSCRIPTIONS_FILE)) {
      return { subscriptions: [] }
    }
    const data = readFileSync(SUBSCRIPTIONS_FILE, 'utf-8')
    return JSON.parse(data) as SubscriptionsData
  } catch {
    return { subscriptions: [] }
  }
}

/**
 * Save subscriptions to file
 */
function saveSubscriptions(data: SubscriptionsData): void {
  ensureDir()
  writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(data, null, 2))
}

/**
 * List all push subscriptions
 */
export function listSubscriptions(): StoredSubscription[] {
  return loadSubscriptions().subscriptions
}

/**
 * Add a push subscription
 */
export function addSubscription(subscription: Omit<StoredSubscription, 'createdAt'>): void {
  const data = loadSubscriptions()

  // Check if subscription already exists (by endpoint)
  const existingIndex = data.subscriptions.findIndex((s) => s.endpoint === subscription.endpoint)

  if (existingIndex >= 0) {
    // Update existing subscription
    data.subscriptions[existingIndex] = {
      ...subscription,
      createdAt: data.subscriptions[existingIndex].createdAt
    }
  } else {
    // Add new subscription
    data.subscriptions.push({
      ...subscription,
      createdAt: new Date().toISOString()
    })
  }

  saveSubscriptions(data)
}

/**
 * Remove a push subscription by endpoint
 */
export function removeSubscription(endpoint: string): void {
  const data = loadSubscriptions()
  data.subscriptions = data.subscriptions.filter((s) => s.endpoint !== endpoint)
  saveSubscriptions(data)
}

/**
 * Clear all push subscriptions
 */
export function clearSubscriptions(): void {
  saveSubscriptions({ subscriptions: [] })
}
