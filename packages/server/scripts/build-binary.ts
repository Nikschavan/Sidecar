#!/usr/bin/env bun
/**
 * Build Sidecar binary
 *
 * Steps:
 * 1. Build web app (pnpm)
 * 2. Generate embedded assets manifest
 * 3. Compile binary with Bun
 */

import { $ } from 'bun'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')
const SERVER = join(import.meta.dir, '..')

async function main() {
  console.log('=== Building Sidecar Binary ===\n')

  // Step 1: Build web app
  console.log('Step 1: Building web app...')
  await $`pnpm --filter @sidecar/web build`.cwd(ROOT)
  console.log('Web app built.\n')

  // Step 2: Generate embedded assets
  console.log('Step 2: Generating embedded assets...')
  await $`bun ${join(SERVER, 'scripts/generate-embedded-assets.ts')}`
  console.log('Assets generated.\n')

  // Step 3: Compile binary
  console.log('Step 3: Compiling binary...')

  const target = process.argv[2] || `bun-${process.platform}-${process.arch}`
  const outfile = process.argv[3] || join(SERVER, 'sidecar')

  await $`bun build --compile --target=${target} --outfile=${outfile} ${join(SERVER, 'src/cli.ts')}`

  console.log(`\nBinary created: ${outfile}`)
  console.log('\nTest with:')
  console.log(`  ${outfile} --help`)
  console.log(`  ${outfile} start`)
}

main().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
