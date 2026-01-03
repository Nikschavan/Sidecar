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

/**
 * Set up Claude Code notification hooks to forward to Sidecar server
 */
export function setupClaudeHooks(sidecarPort: number): void {
  const claudeDir = join(homedir(), '.claude')
  const settingsPath = join(claudeDir, 'settings.json')

  // Path to the hook script (relative to the built dist folder)
  // __dirname is dist/claude/, so go up one level to dist/, then into hooks/
  const hookScriptPath = join(__dirname, '..', 'hooks', 'sidecar-hook.js')

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
    console.log(`[hooks] Created Claude directory: ${claudeDir}`)
  }

  // Read existing settings or create new
  let settings: ClaudeSettings = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch (err) {
      console.error(`[hooks] Failed to parse existing settings.json: ${(err as Error).message}`)
      console.log(`[hooks] Creating new settings.json`)
    }
  }

  // Create the Sidecar notification hook command
  const sidecarHook: ClaudeHook = {
    type: 'command',
    command: `SIDECAR_PORT=${sidecarPort} node "${hookScriptPath}"`
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
    // Update existing hook with new port
    settings.hooks.Notification[existingIndex].hooks = [sidecarHook]
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
      // Remove Sidecar hooks
      settings.hooks.Notification = settings.hooks.Notification.filter(
        (h) => !h.hooks?.some((hook) => hook.command?.includes('sidecar-hook'))
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
