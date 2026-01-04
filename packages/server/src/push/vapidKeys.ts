/**
 * VAPID Key Management
 *
 * Manages VAPID (Voluntary Application Server Identification) keys for Web Push
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import webPush from 'web-push'

const SIDECAR_DIR = join(homedir(), '.sidecar')
const VAPID_FILE = join(SIDECAR_DIR, 'vapid.json')

export interface VapidKeys {
  publicKey: string
  privateKey: string
}

interface VapidData {
  publicKey: string
  privateKey: string
  createdAt: string
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
 * Load VAPID keys from file
 */
function loadVapidData(): VapidData | null {
  try {
    if (!existsSync(VAPID_FILE)) {
      return null
    }
    const data = readFileSync(VAPID_FILE, 'utf-8')
    return JSON.parse(data) as VapidData
  } catch {
    return null
  }
}

/**
 * Save VAPID keys to file
 */
function saveVapidData(data: VapidData): void {
  ensureDir()
  writeFileSync(VAPID_FILE, JSON.stringify(data, null, 2))
}

/**
 * Load existing VAPID keys or generate new ones
 */
export function getOrCreateVapidKeys(): VapidKeys {
  const existing = loadVapidData()
  if (existing?.publicKey && existing?.privateKey) {
    return {
      publicKey: existing.publicKey,
      privateKey: existing.privateKey
    }
  }

  // Generate new VAPID keys
  const keys = webPush.generateVAPIDKeys()
  saveVapidData({
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    createdAt: new Date().toISOString()
  })

  return keys
}

/**
 * Get the public VAPID key (for client-side use)
 */
export function getVapidPublicKey(): string | null {
  const data = loadVapidData()
  return data?.publicKey || null
}
