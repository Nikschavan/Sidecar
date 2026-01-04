/**
 * Authentication Utilities for Web Client
 */

const TOKEN_KEY = 'sidecar_auth_token'

/**
 * Get the stored auth token
 */
export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

/**
 * Store the auth token
 */
export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

/**
 * Clear the auth token
 */
export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * Check if we have a stored auth token
 */
export function hasAuthToken(): boolean {
  return !!getAuthToken()
}

/**
 * Get headers with auth token
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Get WebSocket URL with auth token
 * @deprecated Use getAuthenticatedSseUrl instead
 */
export function getAuthenticatedWsUrl(baseWsUrl: string): string {
  const token = getAuthToken()
  if (token) {
    return `${baseWsUrl}?token=${encodeURIComponent(token)}`
  }
  return baseWsUrl
}

/**
 * Get SSE URL with auth token
 * EventSource API doesn't support custom headers, so we pass token as query param
 */
export function getAuthenticatedSseUrl(baseSseUrl: string): string {
  const token = getAuthToken()
  if (token) {
    const url = new URL(baseSseUrl, window.location.origin)
    url.searchParams.set('token', token)
    return url.toString()
  }
  return baseSseUrl
}
