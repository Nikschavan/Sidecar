/**
 * Claude Code Hooks Configuration
 *
 * Sets up Claude Code notification hooks to forward events to Sidecar.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface ClaudeHook {
  type: 'command'
  command: string
}

interface ClaudeNotificationHook {
  matcher?: string
  hooks: ClaudeHook[]
}

interface ClaudeSettings {
  hooks?: {
    Notification?: ClaudeNotificationHook[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

// Embedded hook script content (for binary distribution)
const HOOK_SCRIPT_CONTENT = `#!/usr/bin/env node
const http = require('http')

const port = process.env.SIDECAR_PORT || 7865
const host = process.env.SIDECAR_HOST || 'localhost'
const token = process.env.SIDECAR_TOKEN || ''

let data = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { data += chunk })

process.stdin.on('end', () => {
  if (!data) { process.exit(0) }
  try {
    const hookData = JSON.parse(data)
    const postData = JSON.stringify(hookData)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
    if (token) { headers['Authorization'] = 'Bearer ' + token }
    const options = {
      hostname: host, port: port, path: '/api/claude-hook',
      method: 'POST', headers, timeout: 500
    }
    const req = http.request(options, (res) => {
      res.on('data', () => {})
      res.on('end', () => process.exit(0))
    })
    req.on('error', () => process.exit(0))
    req.on('timeout', () => { req.destroy(); process.exit(0) })
    req.write(postData)
    req.end()
  } catch (err) { process.exit(0) }
})
process.stdin.on('error', () => process.exit(0))
`

/**
 * Get the hook script path, extracting it to ~/.sidecar if needed
 */
function getHookScriptPath(): string {
  const sidecarDir = join(homedir(), '.sidecar')
  const extractedPath = join(sidecarDir, 'sidecar-hook.cjs')

  // Ensure .sidecar directory exists
  if (!existsSync(sidecarDir)) {
    mkdirSync(sidecarDir, { recursive: true })
  }

  // Always write the hook script to ensure it's up to date
  try {
    writeFileSync(extractedPath, HOOK_SCRIPT_CONTENT)
    console.log(`[hooks] Extracted hook script to ${extractedPath}`)
  } catch (err) {
    console.error(`[hooks] Failed to extract hook script: ${(err as Error).message}`)
  }

  return extractedPath
}

/**
 * Set up Claude Code notification hooks to forward to Sidecar server
 */
export function setupClaudeHooks(sidecarPort: number, authToken?: string): void {
  const claudeDir = join(homedir(), '.claude')
  const settingsPath = join(claudeDir, 'settings.json')

  // Get hook script path (extracts to ~/.sidecar if running from binary)
  const hookScriptPath = getHookScriptPath()

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
    console.log(`[hooks] Created Claude directory: ${claudeDir}`)
  }

  // Read existing settings - bail out if we can't parse to avoid overwriting user config
  let settings: ClaudeSettings = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch (err) {
      console.error(`[hooks] Failed to parse existing settings.json: ${(err as Error).message}`)
      console.error(`[hooks] Skipping hook setup to avoid overwriting user settings`)
      return
    }
  }

  // Create the Sidecar notification hook command
  // Pass port and auth token via environment variables
  const envVars = `SIDECAR_PORT=${sidecarPort}${authToken ? ` SIDECAR_TOKEN=${authToken}` : ''}`
  const sidecarHook: ClaudeHook = {
    type: 'command',
    command: `${envVars} node ${hookScriptPath}`
  }

  // Ensure hooks.Notification array exists
  settings.hooks = settings.hooks || {}
  settings.hooks.Notification = settings.hooks.Notification || []

  // Check if Sidecar hook already exists
  const existingIndex = settings.hooks.Notification.findIndex(
    (h) => h.hooks?.some((hook) => hook.command?.includes('sidecar-hook'))
  )

  if (existingIndex === -1) {
    // Add new hook entry for permission_prompt notifications
    settings.hooks.Notification.push({
      matcher: 'permission_prompt',
      hooks: [sidecarHook]
    })
    console.log(`[hooks] Added Sidecar notification hook to Claude settings`)
  } else {
    // Update only the sidecar hook command, preserving other hooks in the same entry
    const entry = settings.hooks.Notification[existingIndex]
    const otherHooks = (entry.hooks || []).filter(
      (hook) => !hook.command?.includes('sidecar-hook')
    )
    entry.hooks = [...otherHooks, sidecarHook]
    console.log(`[hooks] Updated existing Sidecar notification hook`)
  }

  // Write settings back
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  console.log(`[hooks] Configured Claude hooks in ${settingsPath}`)
}

/**
 * Remove Sidecar hooks from Claude settings (cleanup)
 */
export function removeClaudeHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json')

  if (!existsSync(settingsPath)) {
    return
  }

  try {
    const settings: ClaudeSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))

    if (settings.hooks?.Notification) {
      // Remove only the sidecar hook commands from each entry, preserving other hooks
      for (const entry of settings.hooks.Notification) {
        if (entry.hooks?.some((hook) => hook.command?.includes('sidecar-hook'))) {
          entry.hooks = entry.hooks.filter(
            (hook) => !hook.command?.includes('sidecar-hook')
          )
        }
      }

      // Remove entries that have no hooks left
      settings.hooks.Notification = settings.hooks.Notification.filter(
        (h) => h.hooks && h.hooks.length > 0
      )

      // Clean up empty arrays
      if (settings.hooks.Notification.length === 0) {
        delete settings.hooks.Notification
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      console.log(`[hooks] Removed Sidecar hooks from Claude settings`)
    }
  } catch (err) {
    console.error(`[hooks] Failed to remove hooks: ${(err as Error).message}`)
  }
}
