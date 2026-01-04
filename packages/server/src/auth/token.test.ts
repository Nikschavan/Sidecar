/**
 * Auth Token Tests
 *
 * Tests that API endpoints properly enforce authentication.
 * Run with: pnpm test:auth
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { createServer, type Server } from 'node:http'
import { createApp } from '../app.js'
import { generateToken, setTestToken } from './token.js'

const TEST_PORT = 13456
const TEST_TOKEN = 'test-token-for-auth-testing-1234'

describe('Token Utilities', () => {
  it('generates a 32-character token', () => {
    const token = generateToken()
    assert.strictEqual(token.length, 32)
    assert.match(token, /^[A-Za-z0-9_-]+$/)
  })

  it('generates unique tokens', () => {
    const token1 = generateToken()
    const token2 = generateToken()
    assert.notStrictEqual(token1, token2)
  })
})

describe('Auth Middleware', () => {
  let server: Server
  const baseUrl = `http://localhost:${TEST_PORT}`

  before(async () => {
    // Set test token for validation
    setTestToken(TEST_TOKEN)

    const app = createApp('test-vapid-public-key')

    // Create HTTP server wrapping Hono app
    server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', baseUrl)
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key] = value
        }
      }

      const request = new Request(url.toString(), {
        method: req.method,
        headers
      })

      const response = await app.fetch(request)
      res.statusCode = response.status
      response.headers.forEach((value, key) => {
        res.setHeader(key, value)
      })
      const body = await response.text()
      res.end(body)
    })

    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, resolve)
    })
  })

  after(async () => {
    // Clean up test token
    setTestToken(null)

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  it('allows /health without auth', async () => {
    const res = await fetch(`${baseUrl}/health`)
    assert.strictEqual(res.status, 200)
    const data = await res.json() as { status: string }
    assert.strictEqual(data.status, 'ok')
  })

  it('rejects /api/* without auth header', async () => {
    const res = await fetch(`${baseUrl}/api/claude/projects`)
    assert.strictEqual(res.status, 401)
    const data = await res.json() as { error: string }
    assert.strictEqual(data.error, 'Authorization header required')
  })

  it('rejects /api/* with invalid token format', async () => {
    const res = await fetch(`${baseUrl}/api/claude/projects`, {
      headers: {
        'Authorization': 'InvalidFormat'
      }
    })
    assert.strictEqual(res.status, 401)
    const data = await res.json() as { error: string }
    assert.strictEqual(data.error, 'Invalid Authorization header format. Use: Bearer <token>')
  })

  it('rejects /api/* with wrong token', async () => {
    const res = await fetch(`${baseUrl}/api/claude/projects`, {
      headers: {
        'Authorization': 'Bearer wrong-token-value'
      }
    })
    assert.strictEqual(res.status, 401)
    const data = await res.json() as { error: string }
    assert.strictEqual(data.error, 'Invalid token')
  })

  it('accepts /api/* with valid token', async () => {
    const res = await fetch(`${baseUrl}/api/claude/projects`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`
      }
    })
    // Should not be 401 - auth passed
    assert.notStrictEqual(res.status, 401, 'Should not return 401 with valid token')
  })
})
