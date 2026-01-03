/**
 * Token Authentication Utilities
 *
 * Manages auth token generation, storage, and validation
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SIDECAR_DIR = join(homedir(), '.sidecar')
const AUTH_FILE = join(SIDECAR_DIR, 'auth.json')
const TOKEN_LENGTH = 32

interface AuthData {
  token: string
  createdAt: string
}

/**
 * Generate a random alphanumeric token
 */
export function generateToken(): string {
  return randomBytes(TOKEN_LENGTH)
    .toString('base64url')
    .slice(0, TOKEN_LENGTH)
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
 * Load auth data from file
 */
function loadAuthData(): AuthData | null {
  try {
    if (!existsSync(AUTH_FILE)) {
      return null
    }
    const data = readFileSync(AUTH_FILE, 'utf-8')
    return JSON.parse(data) as AuthData
  } catch {
    return null
  }
}

/**
 * Save auth data to file
 */
function saveAuthData(data: AuthData): void {
  ensureDir()
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2))
}

/**
 * Load existing token or generate a new one
 */
export function loadOrCreateToken(): string {
  const existing = loadAuthData()
  if (existing?.token) {
    return existing.token
  }

  // Generate new token
  const token = generateToken()
  saveAuthData({
    token,
    createdAt: new Date().toISOString()
  })
  return token
}

/**
 * Get the current token (returns null if none exists)
 */
export function getToken(): string | null {
  const data = loadAuthData()
  return data?.token || null
}

/**
 * Rotate the token (generate new one and save)
 */
export function rotateToken(): string {
  const token = generateToken()
  saveAuthData({
    token,
    createdAt: new Date().toISOString()
  })
  return token
}

// Test override - allows tests to set a known token
let testTokenOverride: string | null = null

/**
 * Set a test token (for testing only)
 */
export function setTestToken(token: string | null): void {
  testTokenOverride = token
}

/**
 * Validate a token against the stored token
 */
export function validateToken(token: string): boolean {
  const storedToken = testTokenOverride || getToken()
  if (!storedToken) {
    return false
  }
  // Constant-time comparison to prevent timing attacks
  if (token.length !== storedToken.length) {
    return false
  }
  let result = 0
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ storedToken.charCodeAt(i)
  }
  return result === 0
}

/**
 * Get the path to the auth file (for display purposes)
 */
export function getAuthFilePath(): string {
  return AUTH_FILE
}
