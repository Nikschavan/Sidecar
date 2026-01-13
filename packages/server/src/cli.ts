#!/usr/bin/env bun
/**
 * Sidecar CLI
 *
 * Main entry point for the compiled binary.
 * Provides commands: start, stop, status, token
 */

import { parseArgs } from 'util'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Sidecar directory for runtime files
const SIDECAR_DIR = join(homedir(), '.sidecar')
const PID_FILE = join(SIDECAR_DIR, 'sidecar.pid')
const LOG_FILE = join(SIDECAR_DIR, 'sidecar.log')

function ensureDir(): void {
  if (!existsSync(SIDECAR_DIR)) {
    mkdirSync(SIDECAR_DIR, { recursive: true })
  }
}

interface PidInfo {
  pid: number
  port: number
  startedAt: string
}

function readPidFile(): PidInfo | null {
  try {
    if (!existsSync(PID_FILE)) return null
    return JSON.parse(readFileSync(PID_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function writePidFile(info: PidInfo): void {
  ensureDir()
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2))
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
  } catch {}
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function startServer(port: number, foreground: boolean): Promise<void> {
  // Check if already running
  const existing = readPidFile()
  if (existing && isProcessRunning(existing.pid)) {
    console.log(`Sidecar is already running (PID: ${existing.pid}, Port: ${existing.port})`)
    console.log(`\nWeb UI: http://localhost:${existing.port}`)
    return
  }

  // Clean up stale PID file
  if (existing) {
    removePidFile()
  }

  if (foreground) {
    // Run server in foreground
    process.env.PORT = String(port)
    writePidFile({ pid: process.pid, port, startedAt: new Date().toISOString() })

    // Import and start server
    await import('./index.js')
  } else {
    // Start as background process
    const Bun = (globalThis as any).Bun
    if (!Bun) {
      console.log('Background mode requires Bun runtime. Running in foreground...')
      process.env.PORT = String(port)
      writePidFile({ pid: process.pid, port, startedAt: new Date().toISOString() })
      await import('./index.js')
      return
    }

    ensureDir()

    // Use shell to spawn detached process with nohup
    const fs = require('fs')
    const { spawn } = require('child_process')

    const out = fs.openSync(LOG_FILE, 'a')
    const err = fs.openSync(LOG_FILE, 'a')

    const child = spawn(process.execPath, ['start', '-f', '-p', String(port)], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: process.cwd(),
    })

    // Detach from parent
    child.unref()

    // Wait for server to start and write its PID file
    await new Promise((r) => setTimeout(r, 2000))

    // Check if server wrote its PID file and is running
    const info = readPidFile()
    if (!info || !isProcessRunning(info.pid)) {
      console.log('Failed to start server. Check logs:', LOG_FILE)
      removePidFile()
      return
    }

    // Import network utils for displaying URLs
    const { formatNetworkUrls } = await import('./utils/network.js')

    // Load token
    let token = ''
    const authFile = join(SIDECAR_DIR, 'auth.json')
    try {
      if (existsSync(authFile)) {
        const auth = JSON.parse(readFileSync(authFile, 'utf-8'))
        token = auth.token
      }
    } catch {}

    console.log(`Sidecar started (PID: ${info.pid})`)
    console.log(`\nWeb UI:`)
    console.log(formatNetworkUrls(port, 'http'))
    console.log(`\nToken: ${token}`)
    console.log(`  File: ${authFile}`)
    console.log(`\nLogs: ${LOG_FILE}`)
  }
}

async function stopServer(): Promise<void> {
  const info = readPidFile()

  if (!info) {
    console.log('Sidecar is not running')
    return
  }

  if (!isProcessRunning(info.pid)) {
    console.log('Sidecar process not found, cleaning up stale PID file')
    removePidFile()
    return
  }

  try {
    process.kill(info.pid, 'SIGTERM')
    console.log(`Stopping Sidecar (PID: ${info.pid})...`)

    // Wait for process to exit
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (!isProcessRunning(info.pid)) {
        removePidFile()
        console.log('Sidecar stopped')
        return
      }
    }

    // Force kill if still running
    process.kill(info.pid, 'SIGKILL')
    removePidFile()
    console.log('Sidecar force stopped')
  } catch (error) {
    console.log('Failed to stop Sidecar:', error)
  }
}

async function showStatus(): Promise<void> {
  const info = readPidFile()

  if (!info || !isProcessRunning(info.pid)) {
    console.log('Sidecar is not running')
    if (info) removePidFile()
    return
  }

  // Load token
  const authFile = join(SIDECAR_DIR, 'auth.json')
  let token = '<unknown>'
  try {
    if (existsSync(authFile)) {
      const auth = JSON.parse(readFileSync(authFile, 'utf-8'))
      token = auth.token
    }
  } catch {}

  // Import network utils
  const { formatNetworkUrls } = await import('./utils/network.js')

  console.log(`
Sidecar Status: Running

  PID:     ${info.pid}
  Port:    ${info.port}
  Started: ${info.startedAt}

Web UI:
${formatNetworkUrls(info.port, 'http')}

WebSocket:
${formatNetworkUrls(info.port, 'ws')}

Token: ${token}
  File: ${authFile}
`)
}

async function handleToken(rotate: boolean): Promise<void> {
  const authFile = join(SIDECAR_DIR, 'auth.json')

  if (rotate) {
    const { rotateToken } = await import('./auth/token.js')
    const newToken = rotateToken()
    console.log(`Token rotated: ${newToken}`)
    console.log('\nRestart server for the new token to take effect.')
    return
  }

  // Show current token
  try {
    if (existsSync(authFile)) {
      const auth = JSON.parse(readFileSync(authFile, 'utf-8'))
      console.log(`Token: ${auth.token}`)
      console.log(`File:  ${authFile}`)
    } else {
      console.log('No token found. Run "sidecar start" to generate one.')
    }
  } catch {
    console.log('Failed to read token')
  }
}

function showHelp(): void {
  console.log(`
Sidecar - Remote control for Claude Code

Usage: sidecar <command> [options]

Commands:
  start          Start the Sidecar server
  stop           Stop the running server
  status         Show server status and connection info
  token          Show or manage auth token

Options:
  -p, --port     Server port (default: 3456)
  -f, --foreground  Run in foreground (don't daemonize)
  --rotate       Rotate the auth token (with 'token' command)
  -h, --help     Show this help message
  -v, --version  Show version

Examples:
  sidecar start              Start server in background
  sidecar start -f           Start server in foreground
  sidecar start -p 8080      Start on custom port
  sidecar status             Show connection info
  sidecar token --rotate     Generate new auth token
`)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: 'string', short: 'p', default: '3456' },
      foreground: { type: 'boolean', short: 'f', default: false },
      rotate: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
  })

  if (values.help) {
    showHelp()
    return
  }

  if (values.version) {
    console.log('sidecar 0.0.3')
    return
  }

  const command = positionals[0] || 'start'
  const port = parseInt(values.port as string, 10)

  switch (command) {
    case 'start':
      await startServer(port, values.foreground as boolean)
      break
    case 'stop':
      await stopServer()
      break
    case 'status':
      await showStatus()
      break
    case 'token':
      await handleToken(values.rotate as boolean)
      break
    case 'help':
      showHelp()
      break
    default:
      console.log(`Unknown command: ${command}`)
      showHelp()
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
