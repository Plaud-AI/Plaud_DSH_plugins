#!/usr/bin/env node
/**
 * Publish every connector to the company registry.
 *
 * The packages are self-contained (the core is inlined into each dist), so the
 * publish order does not matter and no private version coordination is needed.
 *
 * Usage:
 *   $env:NPM_REGISTRY = "http://registry.internal:4873"
 *   pnpm release
 *   pnpm release --dry-run
 *
 * Authenticate once per machine with `npm login --registry <url>`; the token
 * lands in ~/.npmrc and pnpm picks it up from there.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = process.env.NPM_REGISTRY ?? 'http://localhost:4873'
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const workspaces = ['core', 'notion', 'linear', 'slack', 'plaud', 'feishu']

function fail(message) {
  console.error(`publish: ${message}`)
  process.exit(1)
}

if (!process.env.NPM_REGISTRY) {
  console.warn(`publish: NPM_REGISTRY is unset, falling back to ${registry}`)
}

const wanted = []
for (const name of workspaces) {
  const dir = join(root, 'packages', name)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

  if (name !== 'core' && !existsSync(join(dir, 'dist', 'index.js'))) {
    fail(`packages/${name}/dist is missing — run \`pnpm -r build\` first`)
  }

  wanted.push(`${manifest.name}@${manifest.version}`)
}

console.log(`publish: registry ${registry}`)
console.log(`publish: ${wanted.join(', ')}`)

const result = spawnSync(
  pnpm,
  ['-r', 'publish', '--no-git-checks', '--access', 'restricted', '--registry', registry, ...process.argv.slice(2)],
  // Windows cannot spawn a .cmd shim without a shell; every argument here is
  // whitespace-free, so nothing needs quoting.
  { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' },
)

if (result.error) fail(result.error.message)
if (result.status !== 0) {
  fail(
    `pnpm publish exited with ${result.status}\n` +
      '  · 401/403 — authenticate: npm login --registry ' +
      registry +
      '\n  · "cannot publish over" — that version already exists; run `pnpm version:patch` first',
  )
}

console.log('publish: done — everyone picks it up on the next DSH restart')
