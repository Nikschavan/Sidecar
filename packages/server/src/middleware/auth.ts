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
 * Extracts token from Authorization header and validates it.
 * Returns 401 if token is missing or invalid.
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')

  if (!authHeader) {
    return c.json({ error: 'Authorization header required' }, 401)
  }

  // Extract token from "Bearer <token>"
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return c.json({ error: 'Invalid Authorization header format. Use: Bearer <token>' }, 401)
  }

  const token = match[1]

  if (!validateToken(token)) {
    return c.json({ error: 'Invalid token' }, 401)
  }

  // Token is valid, proceed to route handler
  await next()
}
