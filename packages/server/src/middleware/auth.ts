/**
 * Authentication Middleware
 *
 * Validates bearer token for protected routes
 */

import type { Context, Next } from 'hono'
import { validateToken } from '../auth/token.js'

/**
 * Bearer token authentication middleware
 *
 * Extracts token from Authorization header or query param and validates it.
 * Query param auth is supported for SSE endpoints (EventSource can't set headers).
 * Returns 401 if token is missing or invalid.
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  let token: string | null = null

  // Try Authorization header first
  const authHeader = c.req.header('Authorization')
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    if (match) {
      token = match[1]
    }
  }

  // Fall back to query param (for SSE - EventSource can't set headers)
  if (!token) {
    token = c.req.query('token') || null
  }

  if (!token) {
    return c.json({ error: 'Authorization header required' }, 401)
  }

  if (!validateToken(token)) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  // Token is valid, proceed to route handler
  await next()
}
