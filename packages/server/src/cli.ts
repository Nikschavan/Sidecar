#!/usr/bin/env node
/**
 * Sidecar CLI
 *
 * Wrapper around Claude that enables remote control from phone.
 * Run `sidecar` instead of `claude`.
 *
 * Usage:
 *   sidecar              # Start Claude with Sidecar
 *   sidecar --resume     # Resume last session
 */

import { runLoop } from './cli/loop.js'

const args = process.argv.slice(2)
const cwd = process.cwd()

console.log(`
┌─────────────────────────────────────────┐
│             Sidecar                     │
│   Remote control for Claude Code        │
├─────────────────────────────────────────┤
│   LOCAL MODE: Type here as normal       │
│   REMOTE MODE: Control from phone       │
│                                         │
│   Phone takes over → switches to remote │
│   Press any key    → switches to local  │
└─────────────────────────────────────────┘
`)

runLoop({ cwd, args }).catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
